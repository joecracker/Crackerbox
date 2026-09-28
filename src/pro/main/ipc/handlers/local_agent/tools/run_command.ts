import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { spawnStreaming } from "@/ipc/utils/spawn_streaming";
import { execGit } from "@/ipc/utils/git_utils";
import { resolveDirectoryWithinAppPath } from "./path_safety";
import {
  AgentContext,
  ToolDefinition,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";

const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 600;
const MAX_RESULT_OUTPUT_CHARS = 16_000;

const runCommandSchema = z.object({
  command: z
    .string()
    .min(1)
    .describe(
      "The executable to run, e.g. \"npm\", \"git\", \"node\". Not a full shell line.",
    ),
  args: z
    .array(z.string())
    .optional()
    .describe(
      "Arguments to pass to the command, as separate array entries (e.g. [\"install\", \"--save-dev\", \"vitest\"]). Never combine multiple arguments into one string.",
    ),
  cwd: z
    .string()
    .optional()
    .describe(
      "Directory to run the command in, relative to the app's project root. Defaults to the project root. Cannot escape the project directory.",
    ),
  description: z
    .string()
    .max(160)
    .optional()
    .describe("One-line human-readable summary of what this command does."),
  timeout_seconds: z
    .number()
    .int()
    .positive()
    .max(MAX_TIMEOUT_SECONDS)
    .optional()
    .describe(
      `Max seconds to let the command run before it is killed. Default ${DEFAULT_TIMEOUT_SECONDS}, max ${MAX_TIMEOUT_SECONDS}.`,
    ),
});

type RunCommandArgs = z.infer<typeof runCommandSchema>;

function tail(value: string): string {
  return value.length <= MAX_RESULT_OUTPUT_CHARS
    ? value
    : `[Earlier output omitted]\n${value.slice(-MAX_RESULT_OUTPUT_CHARS)}`;
}

function completeStatus(
  ctx: AgentContext,
  title: string,
  body: string,
  state: "finished" | "warning" = "finished",
): void {
  ctx.onXmlComplete(
    `<dyad-status title="${escapeXmlAttr(title)}" state="${state}">\n${escapeXmlContent(body)}\n</dyad-status>`,
  );
}

/**
 * On Windows the shared spawn helper assumes every bare command name is an
 * npm-style `.cmd` shim and appends `.cmd`, which breaks real programs like
 * `node`, `git`, `where` and `cmd`. For this tool only, if a bare name is a
 * real .exe/.com on PATH, use that name so the `.cmd` rule is skipped. Anything
 * else (npm, npx, pnpm, ...) is left alone and still resolves as before.
 */
export function resolveWindowsExeName(
  command: string,
  platform: NodeJS.Platform = process.platform,
  pathEnv: string = process.env.PATH ?? "",
): string {
  if (platform !== "win32" || command.includes(".") || /[\\/]/.test(command)) {
    return command;
  }
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const ext of [".exe", ".com"]) {
    for (const dir of dirs) {
      if (fs.existsSync(path.join(dir, command + ext))) {
        return command + ext;
      }
    }
  }
  return command;
}

export const runCommandTool: ToolDefinition<RunCommandArgs> = {
  name: "run_command",
  description: `Run an arbitrary command-line command in the current app's project folder. Use this when no named tool (add_dependency, run_tests, run_build, run_type_checks, execute_sql, git tools, etc.) already covers what's needed - those are safer and better-verified, so prefer them first.

Good uses: installing or updating a package not covered by add_dependency, running a one-off CLI (a generator, a migration script, a linter), inspecting the environment (node --version, checking installed tools), running a project script defined in package.json.

Do NOT use this to edit files (use write_file / search_replace), to restart or reinstall the app (use restart_app / reinstall_and_restart_app), or to run the project's own build/test/typecheck (use the dedicated tools) - those tools track state the agent relies on and this one does not.

The command runs with the current user's permissions, scoped to the app's project folder (cwd cannot escape it). It has no confirmation step of its own beyond the tool consent prompt - treat it as executing for real, not a dry run.`,
  inputSchema: runCommandSchema,
  defaultConsent: "ask",
  modifiesState: true,

  getConsentPreview: (args) => {
    const argsPreview = args.args?.length ? ` ${args.args.join(" ")}` : "";
    const cwdPreview = args.cwd ? ` (in ${args.cwd})` : "";
    return (
      args.description?.trim() ||
      `Run: ${args.command}${argsPreview}${cwdPreview}`
    );
  },

  shouldTrackMutation: (_args, result) => {
    try {
      const parsed = JSON.parse(result) as { code: number | null };
      return parsed.code === 0;
    } catch {
      return false;
    }
  },

  shouldTrackFileMutation: async (_args, result, ctx) => {
    try {
      const parsed = JSON.parse(result) as { code: number | null };
      if (parsed.code !== 0) return false;
    } catch {
      return false;
    }
    try {
      const status = await execGit(
        [
          "-c",
          "core.fsmonitor=false",
          "status",
          "--porcelain=v1",
          "-z",
          "--untracked-files=all",
        ],
        ctx.appPath,
        { maxBuffer: 64_000 },
      );
      return status.exitCode === 0 && status.stdout.length > 0;
    } catch {
      // Failure to classify must not suppress verification of a real edit.
      return true;
    }
  },

  buildXml: (args, isComplete) =>
    isComplete
      ? undefined
      : `<dyad-status title="Running: ${escapeXmlAttr(args.command ?? "")}"></dyad-status>`,

  execute: async (args: RunCommandArgs, ctx: AgentContext) => {
    const relativeCwd = resolveDirectoryWithinAppPath({
      appPath: ctx.appPath,
      directory: args.cwd ?? ".",
    });
    const cwd = path.resolve(ctx.appPath, relativeCwd);

    const timeoutMs =
      (args.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;

    ctx.onXmlStream(
      `<dyad-status title="Running: ${escapeXmlAttr(args.command)}"></dyad-status>`,
    );

    let result;
    try {
      result = await spawnStreaming({
        command: resolveWindowsExeName(args.command),
        args: args.args ?? [],
        cwd,
        signal: ctx.abortSignal,
        timeoutMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DyadError(
        `Could not start "${args.command}": ${message}`,
        DyadErrorKind.Precondition,
      );
    }

    if (result.aborted) {
      throw new DyadError("Command cancelled.", DyadErrorKind.UserCancelled);
    }

    const output = tail(
      [result.stdout, result.stderr].filter(Boolean).join("\n"),
    );

    if (result.timedOut) {
      const body = `Command timed out after ${Math.round(timeoutMs / 1000)}s and was stopped.\n\n${output}`;
      completeStatus(ctx, "Command timed out", body, "warning");
      return JSON.stringify({ code: null, timedOut: true, output });
    }

    if (result.code !== 0) {
      const body = `Command exited with code ${result.code}.\n\n${output}`;
      completeStatus(ctx, "Command failed", body, "warning");
      return JSON.stringify({ code: result.code, output });
    }

    const body = output || "(no output)";
    completeStatus(ctx, "Command finished", body);
    return JSON.stringify({ code: 0, output });
  },
};