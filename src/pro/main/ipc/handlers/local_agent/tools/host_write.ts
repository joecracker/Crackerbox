import fs from "node:fs/promises";
import path from "node:path";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { applySearchReplace } from "@/pro/main/ipc/processors/search_replace_processor";
import { escapeSearchReplaceMarkers } from "@/pro/shared/search_replace_markers";
import { withLock, getFileWriteKey } from "@/ipc/utils/lock_utils";
import { assertHostPathAllowed } from "./host_read";
import type { AgentContext } from "./types";

// Files that could run by themselves or start with Windows are never written
// outside the project, even with approval.
const BLOCKED_WRITE_EXTENSIONS = new Set([
  ".exe",
  ".dll",
  ".msi",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".scr",
  ".lnk",
  ".reg",
  ".sys",
]);

function assertHostWriteAllowed(target: string): string {
  const resolved = path.resolve(target);
  assertHostPathAllowed(resolved);
  if (BLOCKED_WRITE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new DyadError(
      `Writing ${path.extname(resolved)} files outside the project is not allowed.`,
      DyadErrorKind.Validation,
    );
  }
  if (/[\\/]start menu[\\/]programs[\\/]startup([\\/]|$)/i.test(resolved)) {
    throw new DyadError(
      "Writing to the Windows Startup folder is not allowed.",
      DyadErrorKind.Validation,
    );
  }
  return resolved;
}

async function realTarget(resolved: string): Promise<string> {
  // Follow shortcuts/junctions on the nearest existing parent so a link can't
  // lead into a protected folder.
  let existing = resolved;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(existing);
      return path.join(real, ...rest);
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return resolved;
      rest.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

async function askToChangeOutsideProject(
  ctx: AgentContext,
  toolName: string,
  target: string,
  action: string,
): Promise<void> {
  const ok = await ctx.requireConsent({
    toolName,
    toolDescription: `Change a file outside the project`,
    inputPreview: `${action}: ${target}`,
    forceAsk: true,
  });
  if (!ok) {
    throw new DyadError(
      `The user declined the change to ${target}.`,
      DyadErrorKind.UserCancelled,
    );
  }
}

export async function hostWriteFile(params: {
  filePath: string;
  content: string;
  ctx: AgentContext;
}): Promise<string> {
  const resolved = assertHostWriteAllowed(params.filePath);
  assertHostWriteAllowed(await realTarget(resolved));
  await askToChangeOutsideProject(
    params.ctx,
    "write_file",
    resolved,
    "Write (create or overwrite)",
  );
  await withLock(await getFileWriteKey(resolved), async () => {
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, params.content);
  });
  return `Successfully wrote ${resolved}`;
}

export async function hostSearchReplace(params: {
  filePath: string;
  oldString: string;
  newString: string;
  ctx: AgentContext;
}): Promise<string> {
  const resolved = assertHostWriteAllowed(params.filePath);
  const real = await realTarget(resolved);
  assertHostWriteAllowed(real);
  await askToChangeOutsideProject(
    params.ctx,
    "search_replace",
    resolved,
    "Edit",
  );
  await withLock(await getFileWriteKey(real), async () => {
    let original: string;
    try {
      original = await fs.readFile(real, "utf8");
    } catch {
      throw new DyadError(
        `File does not exist: ${params.filePath}`,
        DyadErrorKind.NotFound,
      );
    }
    const operations = `<<<<<<< SEARCH\n${escapeSearchReplaceMarkers(params.oldString)}\n=======\n${escapeSearchReplaceMarkers(params.newString)}\n>>>>>>> REPLACE`;
    const result = applySearchReplace(original, operations);
    if (!result.success || typeof result.content !== "string") {
      throw new Error(
        `Failed to apply search-replace: ${result.error ?? "unknown"}`,
      );
    }
    await fs.writeFile(real, result.content);
  });
  return `Successfully edited ${resolved}`;
}
