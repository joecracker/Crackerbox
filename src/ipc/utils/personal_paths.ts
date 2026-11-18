import fs from "node:fs";
import path from "node:path";

/**
 * Personal paths: files that live in a shared (public) repo's folder but must
 * never be committed to it or pushed from it. The list is
 * `housemaster/personal-paths.txt` inside the repo; a repo without that file has
 * no personal paths and nothing here changes for it.
 *
 * The same rules are implemented in `housemaster/private-lib.mjs` for the git
 * hooks (they run outside the app). Keep the two in step.
 */

export const PERSONAL_PATHS_FILE = path.join(
  "housemaster",
  "personal-paths.txt",
);

/** One entry per line; `#` starts a comment; a trailing `/` means a folder. */
export function parsePersonalPaths(text: string): string[] {
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

export function isPersonalPath(file: string, patterns: string[]): boolean {
  const normalized = file.replace(/\\/g, "/").replace(/^\.?\//, "");
  return patterns.some((pattern) =>
    pattern.endsWith("/")
      ? normalized.startsWith(pattern) || normalized + "/" === pattern
      : normalized === pattern,
  );
}

export function readPersonalPaths(repoPath: string): string[] {
  try {
    return parsePersonalPaths(
      fs.readFileSync(path.join(repoPath, PERSONAL_PATHS_FILE), "utf8"),
    );
  } catch {
    return [];
  }
}
