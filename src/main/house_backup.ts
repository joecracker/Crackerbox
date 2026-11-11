import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { getDyadAppPath, getElectron, getUserDataPath } from "@/paths/paths";
import { houseDir, readRoster } from "@/pro/main/ipc/handlers/local_agent/house";
import { agentMemoryDir } from "@/pro/main/ipc/handlers/local_agent/agent_memory";
import { parseEnvCreds } from "./telegram_inbound";

const logger = log.scope("house_backup");

// Keeps the sisters safe from an accidental delete.
// - Every night (and on the first run ever) each sister's whole folder is
//   mirrored (nothing is ever removed from the mirror) and a small dated
//   snapshot of her identity (docs, top-level files, private memory, the house
//   folder, the database) is kept for 7 days.
// - Every minute the app checks that each sister's folder is still there. If
//   it is gone or emptied, it is restored from the mirror and Tim is told on
//   Telegram.

export interface BackupTarget {
  id: string;
  folder: string;
  memoryDir: string;
}

export interface BackupCtx {
  root: string;
  /** Optional second copy, for example a folder on the Google Drive drive. */
  also?: string;
  targets: BackupTarget[];
  houseDir: string;
  extraFiles: string[];
  now: Date;
}

const KEEP_SNAPSHOTS = 7;
const SMALL_FILE = 5 * 1024 * 1024;

const pad = (n: number) => String(n).padStart(2, "0");
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const exists = (p: string) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

async function copyTree(
  src: string,
  dst: string,
  skipDir: (name: string) => boolean = () => false,
): Promise<void> {
  await fs.promises.mkdir(dst, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    try {
      if (e.isDirectory()) {
        if (skipDir(e.name)) continue;
        await copyTree(s, d, skipDir);
      } else if (e.isFile()) {
        const st = await fs.promises.stat(s);
        try {
          const dt = await fs.promises.stat(d);
          if (dt.size === st.size && dt.mtimeMs >= st.mtimeMs - 2000) continue;
        } catch {
          // not there yet
        }
        await fs.promises.copyFile(s, d);
        await fs.promises.utimes(d, st.atime, st.mtime);
      }
    } catch (error) {
      logger.warn(`skip ${s}`, error);
    }
  }
}

/** A sister's folder counts as gone when it is missing or has lost both docs and .env. */
export function isHollow(folder: string): boolean {
  if (!exists(folder)) return true;
  return !exists(path.join(folder, "docs")) && !exists(path.join(folder, ".env"));
}

function snapshotDirs(root: string): string[] {
  try {
    return fs
      .readdirSync(path.join(root, "snapshots"))
      .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
      .sort();
  } catch {
    return [];
  }
}

export function pruneSnapshots(root: string, keep = KEEP_SNAPSHOTS) {
  const all = snapshotDirs(root);
  for (const old of all.slice(0, Math.max(0, all.length - keep))) {
    fs.rmSync(path.join(root, "snapshots", old), { recursive: true, force: true });
  }
}

export async function runBackup(ctx: BackupCtx): Promise<void> {
  const snap = path.join(ctx.root, "snapshots", dayKey(ctx.now));
  await fs.promises.mkdir(snap, { recursive: true });
  for (const t of ctx.targets) {
    if (isHollow(t.folder)) continue; // never overwrite a good backup with a hollow shell
    await copyTree(t.folder, path.join(ctx.root, "mirror", t.id), (n) => n === "node_modules");
    // small identity snapshot: top-level small files + docs
    const tsnap = path.join(snap, t.id);
    await fs.promises.mkdir(tsnap, { recursive: true });
    for (const e of await fs.promises.readdir(t.folder, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const s = path.join(t.folder, e.name);
      if ((await fs.promises.stat(s)).size <= SMALL_FILE) {
        await fs.promises.copyFile(s, path.join(tsnap, e.name));
      }
    }
    if (exists(path.join(t.folder, "docs"))) {
      await fs.promises.cp(path.join(t.folder, "docs"), path.join(tsnap, "docs"), { recursive: true, force: true });
    }
    if (exists(t.memoryDir)) {
      await fs.promises.cp(t.memoryDir, path.join(snap, "agent-memory", path.basename(t.memoryDir)), { recursive: true, force: true });
    }
  }
  if (exists(ctx.houseDir)) {
    await fs.promises.cp(ctx.houseDir, path.join(snap, "house"), { recursive: true, force: true });
  }
  for (const f of ctx.extraFiles) {
    if (exists(f)) {
      try {
        await fs.promises.copyFile(f, path.join(snap, path.basename(f)));
      } catch (error) {
        logger.warn(`could not copy ${f}`, error);
      }
    }
  }
  pruneSnapshots(ctx.root);
}

/**
 * Runs the backup into the main folder and, when set, a second copy (skipped
 * with a warning if that drive is not there, for example Drive signed out).
 */
export async function runBackupEverywhere(ctx: BackupCtx): Promise<{ also: boolean }> {
  await runBackup(ctx);
  if (!ctx.also) return { also: false };
  if (!exists(path.parse(ctx.also).root)) {
    logger.warn(`second backup location ${ctx.also} is not available, skipped`);
    return { also: false };
  }
  try {
    await runBackup({ ...ctx, root: ctx.also, also: undefined });
    return { also: true };
  } catch (error) {
    logger.warn("second backup failed", error);
    return { also: false };
  }
}

/** Puts a sister's folder (and, if lost, her private memory) back. Returns false if there is nothing to restore from. */
export async function restoreTarget(ctx: BackupCtx, t: BackupTarget): Promise<boolean> {
  const mirror = path.join(ctx.root, "mirror", t.id);
  if (!exists(path.join(mirror, "docs")) && !exists(path.join(mirror, ".env"))) return false;
  await copyTree(mirror, t.folder, (n) => n === "node_modules");
  const snaps = snapshotDirs(ctx.root);
  const latest = snaps[snaps.length - 1];
  if (latest) {
    const memSrc = path.join(ctx.root, "snapshots", latest, "agent-memory", path.basename(t.memoryDir));
    if (exists(memSrc) && (!exists(t.memoryDir) || fs.readdirSync(t.memoryDir).length === 0)) {
      await fs.promises.cp(memSrc, t.memoryDir, { recursive: true, force: true });
    }
  }
  return true;
}

async function tellTim(text: string) {
  for (const s of readRoster()) {
    try {
      const env = fs.readFileSync(path.join(getDyadAppPath(s.id), ".env"), "utf8");
      const { token, chat } = parseEnvCreds(env);
      if (!token || !chat) continue;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text }),
      });
      return;
    } catch {
      // try the next sister's bot
    }
  }
}

function buildCtx(): BackupCtx {
  const dataDir = getUserDataPath();
  const documents =
    getElectron()?.app.getPath("documents") ?? path.join(dataDir, "..", "Documents");
  let root = path.join(documents, "cb-backups", "nightly");
  let also: string | undefined;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(houseDir(), "backup.json"), "utf8"));
    if (typeof cfg.dir === "string" && cfg.dir) root = cfg.dir;
    if (typeof cfg.also === "string" && cfg.also) also = cfg.also;
  } catch {
    // default
  }
  return {
    root,
    also,
    targets: readRoster().map((s) => ({
      id: s.id,
      folder: getDyadAppPath(s.id),
      memoryDir: agentMemoryDir(s.appId),
    })),
    houseDir: houseDir(),
    extraFiles: ["sqlite.db", "sqlite.db-wal", "sqlite.db-shm"].map((n) => path.join(dataDir, n)),
    now: new Date(),
  };
}

function statePath(root: string) {
  return path.join(root, "backup-state.json");
}

export function startHouseBackup(): () => void {
  let stopped = false;
  let busy = false;
  const restoredAt: Record<string, number> = {};

  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const ctx = buildCtx();
      // 1) restore anything that has vanished
      for (const t of ctx.targets) {
        if (!isHollow(t.folder)) continue;
        if (Date.now() - (restoredAt[t.id] ?? 0) < 10 * 60_000) continue;
        restoredAt[t.id] = Date.now();
        const ok = await restoreTarget(ctx, t);
        logger.warn(`${t.id}: folder was missing, restored=${ok}`);
        await tellTim(
          ok
            ? `Heads up: ${t.id}'s folder was missing or emptied, so I put it back from last night's backup.`
            : `Warning: ${t.id}'s folder is missing and there is no backup to restore from yet.`,
        );
      }
      // 2) nightly backup
      let last = "";
      try {
        last = JSON.parse(fs.readFileSync(statePath(ctx.root), "utf8")).lastRun ?? "";
      } catch {
        // never run
      }
      const noMirror = ctx.targets.some((t) => !exists(path.join(ctx.root, "mirror", t.id)));
      const today = dayKey(ctx.now);
      if (last !== today && (ctx.now.getHours() >= 4 || noMirror)) {
        await runBackupEverywhere(ctx);
        fs.mkdirSync(ctx.root, { recursive: true });
        fs.writeFileSync(statePath(ctx.root), JSON.stringify({ lastRun: today, at: new Date().toISOString() }));
        logger.info("nightly backup done");
      }
    } catch (error) {
      logger.warn("backup tick failed", error);
    } finally {
      busy = false;
    }
  };

  const startTimer = setTimeout(() => void tick(), 60_000);
  const timer = setInterval(() => void tick(), 60_000);
  return () => {
    stopped = true;
    clearTimeout(startTimer);
    clearInterval(timer);
  };
}