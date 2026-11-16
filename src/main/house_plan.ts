import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { houseDir } from "@/pro/main/ipc/handlers/local_agent/house";

// The housemaster's approved plan. Tim says yes once to a plain-English
// description plus the list of files she will touch (the propose_change tool).
// The install tool then checks the real changed files against that list: if
// nothing outside the plan changed, the one yes covers the install too; if any
// other file changed, Tim is asked again. The plan is private to this computer
// (it lives in the house folder, never in the repo) and is used once.

export interface ApprovedPlan {
  summary: string;
  files: string[];
  head: string;
  approvedAt: string;
}

export function planPath(): string {
  return path.join(houseDir(), "approved-plan.json");
}

export function repoDir(): string {
  return path.join(os.homedir(), "Documents", "dyad");
}

export function normalizeFile(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

export function readPlan(): ApprovedPlan | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(planPath(), "utf8"));
    if (
      typeof parsed?.head === "string" &&
      Array.isArray(parsed.files) &&
      parsed.files.every((f: unknown) => typeof f === "string")
    ) {
      return parsed as ApprovedPlan;
    }
  } catch {
    // no plan, or an unreadable one: treated as no plan
  }
  return null;
}

export function savePlan(plan: ApprovedPlan): void {
  fs.mkdirSync(houseDir(), { recursive: true });
  fs.writeFileSync(planPath(), JSON.stringify(plan, null, 2));
}

export function clearPlan(): void {
  fs.rmSync(planPath(), { force: true });
}

/** Paths from `git status --porcelain=v1 -z -uall` (renames list both names). */
export function parseStatus(out: string): string[] {
  const parts = out.split("\0");
  const files: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    files.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C" || entry[1] === "R") {
      if (parts[i + 1]) files.push(parts[i + 1]);
      i++;
    }
  }
  return files;
}

export interface PlanCheck {
  ok: boolean;
  reason?: string;
  /** Changed files the plan did not list. */
  extra: string[];
}

export function checkPlan(
  plan: ApprovedPlan | null,
  changed: string[],
  head: string,
): PlanCheck {
  if (!plan) {
    return {
      ok: false,
      reason: "There is no approved plan for this install.",
      extra: changed,
    };
  }
  if (plan.head !== head) {
    return {
      ok: false,
      reason:
        "The code was committed or switched to another version after the plan was approved.",
      extra: [],
    };
  }
  const allowed = new Set(plan.files.map(normalizeFile));
  const extra = changed.filter((f) => !allowed.has(normalizeFile(f)));
  if (extra.length) {
    return {
      ok: false,
      reason: "These changed files were not in the plan Tim approved.",
      extra,
    };
  }
  return { ok: true, extra: [] };
}

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) =>
        error ? reject(new Error(stderr || error.message)) : resolve(stdout),
    );
  });
}

export async function currentHead(repo = repoDir()): Promise<string> {
  return (await git(["rev-parse", "HEAD"], repo)).trim();
}

export async function changedFiles(repo = repoDir()): Promise<string[]> {
  return parseStatus(
    await git(["status", "--porcelain=v1", "-z", "-uall"], repo),
  );
}

/** Checks the real changed files against the approved plan. Never throws. */
export async function evaluateInstall(): Promise<PlanCheck> {
  try {
    const [changed, head] = await Promise.all([changedFiles(), currentHead()]);
    return checkPlan(readPlan(), changed, head);
  } catch (e) {
    return {
      ok: false,
      reason: `Could not read the code's changes (${(e as Error).message.slice(0, 160)}).`,
      extra: [],
    };
  }
}
