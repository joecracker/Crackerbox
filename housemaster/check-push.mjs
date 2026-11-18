// Blocks a push that would send personal material to the PUBLIC remote.
// Runs from .husky/pre-push, which gets one line per ref on stdin:
//   <local ref> <local sha> <remote ref> <remote sha>
// For each ref it looks at only the commits that would leave this computer:
//   - any file named in housemaster/personal-paths.txt, or
//   - text copied from the private house prompt files.
// It never prints private text, only file names and counts.
import fs from "node:fs";
import {
  addedTextByFile,
  findTextLeaks,
  git,
  isPersonalPath,
  privateTexts,
  readPersonalPaths,
  squash,
} from "./private-lib.mjs";

const ZERO = /^0+$/;
const input = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);

const personal = readPersonalPaths();
const texts = privateTexts();
if (personal.length === 0 && texts.length === 0) process.exit(0);

const problems = [];

for (const line of input) {
  const [localRef, localSha, , remoteSha] = line.split(" ");
  if (!localSha || ZERO.test(localSha)) continue; // deleting a branch
  // New remote branch: everything not already on a remote counts as outgoing.
  const range = ZERO.test(remoteSha ?? "0")
    ? [localSha, "--not", "--remotes"]
    : [`${remoteSha}..${localSha}`];

  if (personal.length > 0) {
    const names = git([
      "-c",
      "core.quotepath=false",
      "log",
      "--name-only",
      "--format=",
      ...range,
    ])
      .split(/\r?\n/)
      .filter(Boolean);
    const hits = [...new Set(names.filter((f) => isPersonalPath(f, personal)))];
    for (const f of hits)
      problems.push(`${localRef}: ${f} is on the personal list`);
  }

  if (texts.length > 0) {
    // Compare the whole outgoing change against its base.
    const base = ZERO.test(remoteSha ?? "0")
      ? git(["merge-base", localSha, "--remotes"]).trim() || null
      : remoteSha;
    if (base) {
      const diff = git([
        "diff",
        "-U0",
        "--no-color",
        "--no-ext-diff",
        base,
        localSha,
      ]);
      const before = (file) => {
        try {
          return squash(git(["show", `${base}:${file}`]));
        } catch {
          return "";
        }
      };
      for (const l of findTextLeaks(texts, addedTextByFile(diff), before)) {
        problems.push(
          `${localRef}: ${l.file} has ${l.hits} passages from your private prompt files`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error(
    "\nPUSH BLOCKED: personal material is in the commits you are pushing.",
  );
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "The repo is public. Nothing was sent. Move personal files to the private history (housemaster\\pgit) and rebuild the branch without them.\n",
  );
  process.exit(1);
}
