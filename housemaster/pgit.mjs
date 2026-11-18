// pgit: a private, local-only git history for the personal files listed in
// housemaster/personal-paths.txt. It lives in its own git folder OUTSIDE this
// repo (default: Documents\cb-private.git), has no remote, and so can never be
// pushed to GitHub. The files themselves stay where the app reads them.
//
//   node housemaster/pgit.mjs init [gitdir]   one-time setup
//   node housemaster/pgit.mjs snapshot        commit the current personal files
//   node housemaster/pgit.mjs <any git args>  e.g. log, status, diff
//
// Where the private history lives is remembered in <repo>/.git/cb-private-gitdir
// (a local file; never committed).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  git,
  isPersonalPath,
  readPersonalPaths,
  repoRoot,
} from "./private-lib.mjs";

const root = repoRoot();
const pointer = path.join(root, ".git", "cb-private-gitdir");

function run(gitDir, args, opts = {}) {
  return execFileSync(
    "git",
    [`--git-dir=${gitDir}`, `--work-tree=${root}`, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts },
  );
}

function gitDirOrExit() {
  if (!fs.existsSync(pointer)) {
    console.error(
      "pgit is not set up here yet. Run: node housemaster/pgit.mjs init",
    );
    process.exit(1);
  }
  return fs.readFileSync(pointer, "utf8").trim();
}

function snapshot(gitDir, quiet = false) {
  const paths = readPersonalPaths(root);
  for (const p of paths) {
    try {
      run(gitDir, ["add", "-A", "-f", "--", p]);
    } catch {
      // The path does not exist yet and was never saved: nothing to add.
    }
  }
  const pending = run(gitDir, [
    "status",
    "--porcelain",
    "--untracked-files=no",
  ]).trim();
  if (!pending) {
    if (!quiet) console.log("Nothing new in the personal files.");
    return;
  }
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  run(gitDir, [
    "-c",
    "user.name=pgit",
    "-c",
    "user.email=pgit@localhost",
    "commit",
    "-q",
    "-m",
    `Personal files ${stamp}`,
  ]);
  if (!quiet) console.log("Saved a snapshot of the personal files.");
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "init") {
  const gitDir = path.resolve(
    rest[0] ?? path.join(os.homedir(), "Documents", "cb-private.git"),
  );
  if (!fs.existsSync(gitDir)) {
    fs.mkdirSync(gitDir, { recursive: true });
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", gitDir]);
  }
  fs.writeFileSync(pointer, gitDir + "\n");
  // The private history never shows what the shared repo owns.
  execFileSync("git", [`--git-dir=${gitDir}`, "config", "core.bare", "false"]);
  execFileSync("git", [`--git-dir=${gitDir}`, "config", "core.worktree", root]);
  execFileSync("git", [
    `--git-dir=${gitDir}`,
    "config",
    "status.showUntrackedFiles",
    "no",
  ]);
  // Belt and braces: the shared repo never even sees the personal files.
  const exclude = path.join(root, ".git", "info", "exclude");
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  const have = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
  const missing = readPersonalPaths(root).filter(
    (p) => !have.split(/\r?\n/).includes(p),
  );
  if (missing.length > 0) {
    fs.appendFileSync(
      exclude,
      (have.endsWith("\n") || have === "" ? "" : "\n") +
        missing.join("\n") +
        "\n",
    );
  }
  snapshot(gitDir);
  console.log(`Private history: ${gitDir}`);
} else if (cmd === "snapshot") {
  snapshot(gitDirOrExit(), rest.includes("--quiet"));
} else if (cmd === "check") {
  // Is anything personal tracked by the SHARED repo right now?
  const personal = readPersonalPaths(root);
  const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const bad = tracked.filter((f) => isPersonalPath(f, personal));
  if (bad.length > 0) {
    console.error(`Shared repo tracks ${bad.length} personal file(s):`);
    for (const f of bad) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("The shared repo tracks no personal files.");
} else if (cmd) {
  process.stdout.write(run(gitDirOrExit(), [cmd, ...rest]));
} else {
  console.log("Usage: pgit init | snapshot | check | <git args>");
}
