import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";
import { readSettings } from "@/main/settings";
import { getGitHubApiBase } from "@/ipc/handlers/github_handlers";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_LIST = 100;
const README_CHARS = 2500;

const githubReposSchema = z.object({
  search: z
    .string()
    .optional()
    .describe(
      "Optional. Only list repos whose name or description contains this text (case-insensitive).",
    ),
  repo: z
    .string()
    .optional()
    .describe(
      'Optional. A repo as "owner/name". When given, returns details for that one repo instead of the list: description, language, last update, top-level files, and the start of its README.',
    ),
});

interface RepoRow {
  full_name: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  description: string | null;
  language: string | null;
  pushed_at: string | null;
  updated_at: string | null;
}

let listCache: { at: number; rows: RepoRow[] } | null = null;

function authHeaders(raw = false): Record<string, string> {
  const token = readSettings().githubAccessToken?.value;
  if (!token) {
    throw new DyadError(
      "Not signed in to GitHub. Connect GitHub in Crackerbox settings first.",
      DyadErrorKind.Auth,
    );
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: raw
      ? "application/vnd.github.raw+json"
      : "application/vnd.github+json",
  };
}

async function fetchAllRepos(): Promise<RepoRow[]> {
  if (listCache && Date.now() - listCache.at < CACHE_TTL_MS) {
    return listCache.rows;
  }
  const rows: RepoRow[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(
      `${getGitHubApiBase()}/user/repos?per_page=100&page=${page}&sort=updated`,
      { headers: authHeaders() },
    );
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }
    const batch = (await res.json()) as RepoRow[];
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  listCache = { at: Date.now(), rows };
  return rows;
}

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "unknown";
}

export const githubReposTool: ToolDefinition<
  z.infer<typeof githubReposSchema>
> = {
  name: "github_repos",
  description: `Look up the user's GitHub repositories (read-only). Use this only when the user mentions a project or repo you don't recognize, or asks what one of their repos is or does. Do not call it otherwise.

- With no arguments (or \`search\`): lists repos with description, language, and last update.
- With \`repo\` ("owner/name"): details for that one repo, including its top-level files and the start of its README.
- This tool cannot clone, pull, push, or change anything. If the user wants a repo pulled down or changed, ask them first and use the normal import/GitHub actions.`,
  inputSchema: githubReposSchema,
  defaultConsent: "always",
  modifiesState: false,

  getConsentPreview: (args) =>
    args.repo
      ? `Look up GitHub repo ${args.repo}`
      : args.search
        ? `Search GitHub repos for "${args.search}"`
        : "List GitHub repos",

  execute: async (args, _ctx: AgentContext) => {
    const repoArg = args.repo?.trim();
    if (repoArg) {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repoArg)) {
        return 'Repo must look like "owner/name".';
      }
      const base = getGitHubApiBase();
      const metaRes = await fetch(`${base}/repos/${repoArg}`, {
        headers: authHeaders(),
      });
      if (!metaRes.ok) {
        return `Could not find ${repoArg} (GitHub said ${metaRes.status}).`;
      }
      const m = (await metaRes.json()) as any;
      const out: string[] = [
        `${m.full_name} (${m.private ? "private" : "public"}${m.fork ? ", fork" : ""}${m.archived ? ", archived" : ""})`,
        `Description: ${m.description ?? "none"}`,
        `Language: ${m.language ?? "unknown"} | Default branch: ${m.default_branch} | Last push: ${day(m.pushed_at)}`,
      ];
      if (m.topics?.length) out.push(`Topics: ${m.topics.join(", ")}`);
      if (m.homepage) out.push(`Homepage: ${m.homepage}`);

      const filesRes = await fetch(`${base}/repos/${repoArg}/contents`, {
        headers: authHeaders(),
      });
      if (filesRes.ok) {
        const files = (await filesRes.json()) as any[];
        if (Array.isArray(files)) {
          out.push(
            `Top-level: ${files
              .slice(0, 40)
              .map((f) => (f.type === "dir" ? `${f.name}/` : f.name))
              .join(", ")}`,
          );
        }
      }

      const readmeRes = await fetch(`${base}/repos/${repoArg}/readme`, {
        headers: authHeaders(true),
      });
      if (readmeRes.ok) {
        const text = await readmeRes.text();
        out.push(
          "",
          "README (start):",
          text.length > README_CHARS
            ? `${text.slice(0, README_CHARS)}\n...[README continues]`
            : text,
        );
      } else {
        out.push("", "No README.");
      }
      return out.join("\n");
    }

    const rows = await fetchAllRepos();
    const needle = args.search?.trim().toLowerCase();
    const matches = needle
      ? rows.filter(
          (r) =>
            r.full_name.toLowerCase().includes(needle) ||
            (r.description ?? "").toLowerCase().includes(needle),
        )
      : rows;
    if (matches.length === 0) return "No matching repos found.";

    const shown = matches.slice(0, MAX_LIST);
    const lines = shown.map(
      (r) =>
        `${r.full_name}${r.private ? " [private]" : ""}${r.fork ? " [fork]" : ""}${r.archived ? " [archived]" : ""} - ${r.description ?? "no description"} (${r.language ?? "n/a"}, pushed ${day(r.pushed_at)})`,
    );
    const header = `${matches.length} repo${matches.length === 1 ? "" : "s"}${
      matches.length > MAX_LIST ? `, showing first ${MAX_LIST}` : ""
    }:`;
    return [header, ...lines].join("\n");
  },
};
