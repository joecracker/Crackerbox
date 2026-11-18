// Shared by the git hooks (check-private.mjs for commits, check-push.mjs for
// pushes). Two kinds of protection for this PUBLIC repo:
//   1. Personal paths: files named in housemaster/personal-paths.txt.
//   2. Private wording: passages from the prompt files in the house data folder.
// The app has its own copy of the path rules in src/ipc/utils/personal_paths.ts
// (the hooks run outside the app); keep the two in step. Nothing here ever
// prints private text, only file names and counts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const WINDOW = 40;
export const STEP = 10;

export const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

export function repoRoot() {
  return git(["rev-parse", "--show-toplevel"]).trim();
}

// ---- 1. personal paths -------------------------------------------------

export function parsePersonalPaths(text) {
  return text
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/\\/g, "/")
        .replace(/^\.?\//, ""),
    )
    .filter((line) => line !== "" && !line.startsWith("#"));
}

export function readPersonalPaths(root = repoRoot()) {
  try {
    return parsePersonalPaths(
      fs.readFileSync(
        path.join(root, "housemaster", "personal-paths.txt"),
        "utf8",
      ),
    );
  } catch {
    return [];
  }
}

export function isPersonalPath(file, patterns) {
  const normalized = file.replace(/\\/g, "/").replace(/^\.?\//, "");
  return patterns.some((pattern) =>
    pattern.endsWith("/")
      ? normalized.startsWith(pattern) || normalized + "/" === pattern
      : normalized === pattern,
  );
}

// ---- 2. private wording ------------------------------------------------

function houseFolder() {
  if (process.env.CB_HOUSE_DIR) return process.env.CB_HOUSE_DIR;
  const base =
    process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(base, "Crackerbox", "house");
}

export function privateTexts() {
  const dir = path.join(houseFolder(), "prompts");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".md") || n.endsWith(".txt"))
    .map((n) => squash(fs.readFileSync(path.join(dir, n), "utf8")))
    .filter((t) => t.length >= WINDOW);
}

/** Added lines per file from a unified diff (`git diff -U0` output). */
export function addedTextByFile(diff) {
  const byFile = new Map();
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.startsWith("+++ b/") ? line.slice(6) : null;
      if (file && !byFile.has(file)) byFile.set(file, []);
    } else if (file && line.startsWith("+")) {
      byFile.get(file).push(line.slice(1));
    }
  }
  return byFile;
}

/**
 * Files whose newly added text contains passages from the private prompt files.
 * `before(file)` returns the squashed earlier text of a file, so wording the
 * file already had is not counted as new.
 */
export function findTextLeaks(texts, byFile, before) {
  const leaks = [];
  for (const [file, lines] of byFile) {
    const added = squash(lines.join("\n"));
    if (added.length < WINDOW) continue;
    const earlier = before(file);
    let hits = 0;
    for (const t of texts) {
      for (let i = 0; i + WINDOW <= t.length; i += STEP) {
        const w = t.slice(i, i + WINDOW);
        if (added.includes(w) && !earlier.includes(w)) hits++;
      }
    }
    if (hits > 0) leaks.push({ file, hits });
  }
  return leaks;
}
