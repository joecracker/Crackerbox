// Restore a Crackerbox backup while the app is CLOSED.
//   node scripts/restore-backup.mjs --list
//   node scripts/restore-backup.mjs --restore latest
//   node scripts/restore-backup.mjs --restore <backup-folder-name>
//   (rehearsal on a copy: add --data <copy> --allow-running)
// Optional: --data <folder>  (default: %APPDATA%\Crackerbox)
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? true);
};
const data =
  opt("--data") ||
  path.join(
    process.env.APPDATA || path.join(os.homedir(), ".config"),
    "Crackerbox",
  );
const dir = path.join(data, "backups");
const sha = (f) =>
  createHash("sha256").update(fs.readFileSync(f)).digest("hex");

const backups = fs.existsSync(dir)
  ? fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          fs.existsSync(path.join(dir, e.name, "backup.json")),
      )
      .map((e) => ({
        name: e.name,
        ...JSON.parse(
          fs.readFileSync(path.join(dir, e.name, "backup.json"), "utf8"),
        ),
      }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  : [];

if (opt("--list") || !opt("--restore")) {
  if (!backups.length) console.log("No backups found in", dir);
  for (const b of backups) {
    console.log(`${b.name}   (${b.timestamp}, ${b.reason})`);
  }
  process.exit(0);
}

// For rehearsals on a COPY of the data folder while Crackerbox is open. It only
// works together with --data so it can never touch the live folder by accident.
const allowRunning = args.includes("--allow-running");
if (allowRunning && !opt("--data")) {
  console.error(
    "--allow-running only works together with --data <a copy of the data folder>.",
  );
  process.exit(1);
}

if (process.platform === "win32" && !allowRunning) {
  const running = execSync('tasklist /FI "IMAGENAME eq Crackerbox.exe" /NH', {
    encoding: "utf8",
  });
  if (/Crackerbox\.exe/i.test(running)) {
    console.error(
      "Crackerbox is still running. Close it first, then run this again.",
    );
    process.exit(1);
  }
}

const want = opt("--restore");
const b = want === "latest" ? backups[0] : backups.find((x) => x.name === want);
if (!b) {
  console.error("Backup not found. Use --list to see the names.");
  process.exit(1);
}

const src = path.join(dir, b.name);
const settingsName = "user-settings.json";
const dbName = "sqlite.db";
const live = {
  settings: path.join(data, settingsName),
  db: path.join(data, dbName),
};
for (const [key, file] of [
  ["settings", settingsName],
  ["database", dbName],
]) {
  if (b.files[key] && sha(path.join(src, file)) !== b.checksums[key]) {
    console.error(`Backup ${key} file is damaged. Nothing was changed.`);
    process.exit(1);
  }
}

// Safety copy of whatever is there now.
const safety = path.join(
  dir,
  `pre_restore_${new Date().toISOString().replace(/[:.]/g, "-")}`,
);
fs.mkdirSync(safety, { recursive: true });
for (const f of [live.settings, live.db, `${live.db}-wal`, `${live.db}-shm`]) {
  if (fs.existsSync(f)) fs.copyFileSync(f, path.join(safety, path.basename(f)));
}

if (b.files.settings)
  fs.copyFileSync(path.join(src, settingsName), live.settings);
if (b.files.database) {
  fs.rmSync(`${live.db}-wal`, { force: true });
  fs.rmSync(`${live.db}-shm`, { force: true });
  fs.copyFileSync(path.join(src, dbName), live.db);
}
console.log(`Restored ${b.name}. Your previous files are saved in ${safety}`);
