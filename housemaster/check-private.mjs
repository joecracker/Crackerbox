// Blocks a commit that carries text from this computer's private house files
// (the prompt files in the house data folder) into the public repo.
// Runs from .husky/pre-commit. It never prints the private text itself.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const WINDOW = 40;
const STEP = 10;

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function houseFolder() {
  if (process.env.CB_HOUSE_DIR) return process.env.CB_HOUSE_DIR;
  const base =
    process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(base, "Crackerbox", "house");
}

function privateTexts() {
  const dir = path.join(houseFolder(), "prompts");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".md") || n.endsWith(".txt"))
    .map((n) => squash(fs.readFileSync(path.join(dir, n), "utf8")))
    .filter((t) => t.length >= WINDOW);
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function addedTextByFile() {
  const diff = git(["diff", "--cached", "-U0", "--no-color", "--no-ext-diff"]);
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

function headText(file) {
  try {
    return squash(git(["show", `HEAD:${file}`]));
  } catch {
    return "";
  }
}

const texts = privateTexts();
if (texts.length === 0) process.exit(0);

const leaks = [];
for (const [file, lines] of addedTextByFile()) {
  const added = squash(lines.join("\n"));
  if (added.length < WINDOW) continue;
  const before = headText(file);
  let hits = 0;
  for (const t of texts) {
    for (let i = 0; i + WINDOW <= t.length; i += STEP) {
      const w = t.slice(i, i + WINDOW);
      // Wording the file already had in the last commit is not new.
      if (added.includes(w) && !before.includes(w)) hits++;
    }
  }
  if (hits > 0) leaks.push({ file, hits });
}

if (leaks.length > 0) {
  console.error(
    "\nCOMMIT BLOCKED: text from your private house prompt files is in this commit.",
  );
  for (const l of leaks)
    console.error(`  - ${l.file} (${l.hits} matching passages)`);
  console.error(
    "The repo is public. Keep that text in the house folder, out of the code.\n",
  );
  process.exit(1);
}
