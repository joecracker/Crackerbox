// Blocks a commit that carries personal material into this PUBLIC repo:
//   - any file named in housemaster/personal-paths.txt, or
//   - text copied from the private house prompt files (house data folder).
// Runs from .husky/pre-commit. It never prints the private text itself.
import {
  addedTextByFile,
  findTextLeaks,
  git,
  isPersonalPath,
  privateTexts,
  readPersonalPaths,
  squash,
} from "./private-lib.mjs";

const problems = [];

// 1. personal paths staged for this commit
const personal = readPersonalPaths();
if (personal.length > 0) {
  const staged = git(["diff", "--cached", "--name-only", "-z"])
    .split("\0")
    .filter(Boolean);
  for (const file of staged) {
    if (isPersonalPath(file, personal)) {
      problems.push(`${file} is on the personal list`);
    }
  }
}

// 2. private wording in the added lines
const texts = privateTexts();
if (texts.length > 0) {
  const diff = git(["diff", "--cached", "-U0", "--no-color", "--no-ext-diff"]);
  const headText = (file) => {
    try {
      return squash(git(["show", `HEAD:${file}`]));
    } catch {
      return "";
    }
  };
  for (const l of findTextLeaks(texts, addedTextByFile(diff), headText)) {
    problems.push(
      `${l.file} has ${l.hits} passages from your private prompt files`,
    );
  }
}

if (problems.length > 0) {
  console.error("\nCOMMIT BLOCKED: personal material is in this commit.");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "The repo is public. Keep personal files in the private history (housemaster\\pgit) and private wording in the house folder, out of the code.\n",
  );
  process.exit(1);
}
