import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { getDyadAppPath, getElectron, getUserDataPath } from "@/paths/paths";
import {
  houseDir,
  readRoster,
} from "@/pro/main/ipc/handlers/local_agent/house";
import { agentMemoryDir } from "@/pro/main/ipc/handlers/local_agent/agent_memory";
import { noticeOncePerDay, sendTelegramNotice } from "./house_notice";

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
  /**
   * Writes one consistent copy of the live database to this file. The three
   * database files (main, -wal, -shm) must never be copied one by one while the
   * app is writing: the copies can end up out of step and not open.
   */
  copyDatabase?: (destFile: string) => Promise<void>;
  /** The raw database files, copied only if `copyDatabase` is missing or fails. */
  databaseFiles?: string[];
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

/**
 * Folders the mirror leaves out: node_modules, and the pictures an app keeps
 * under .dyad (media and screenshot). Pictures are not part of who a sister is
 * and made the mirror (and her git history copy) several times bigger.
 * `rel` is the folder's path inside the sister's folder, with "/" separators.
 */
export const mirrorSkip = (name: string, rel: string): boolean =>
  name === "node_modules" ||
  rel === ".dyad/media" ||
  rel === ".dyad/screenshot";

async function copyTree(
  src: string,
  dst: string,
  skipDir: (name: string, rel: string) => boolean = () => false,
  rel = "",
): Promise<void> {
  await fs.promises.mkdir(dst, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    try {
      if (e.isDirectory()) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (skipDir(e.name, childRel)) continue;
        await copyTree(s, d, skipDir, childRel);
      } else if (e.isFile()) {
        const st = await fs.promises.stat(s);
        try {
          const dt = await fs.promises.stat(d);
          if (dt.size === st.size && dt.mtimeMs >= st.mtimeMs - 2000) continue;
        } catch {
          // not there yet
        }
        // git keeps its pack files read-only, and Windows will not overwrite a
        // read-only file. Clear the flag on the old copy first, and on the new
        // one so it can be replaced next time.
        await fs.promises.chmod(d, 0o666).catch(() => {});
        await fs.promises.copyFile(s, d);
        await fs.promises.chmod(d, 0o666).catch(() => {});
        await fs.promises.utimes(d, st.atime, st.mtime);
      }
    } catch (error) {
      logger.warn(`skip ${s}`, error);
    }
  }
}

/** A file that has left the live folder stays in the mirror this long, then goes. */
export const MIRROR_KEEP_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The mirror never removes a file the moment it disappears from the live folder
 * (that is the whole point of it: an accidental delete can be undone). But git
 * rewrites its pack files all the time, and the old ones used to pile up in the
 * mirror for ever. So a file that has been missing from the live folder for
 * MIRROR_KEEP_DAYS in a row is removed from the mirror. `goneFile` remembers
 * when each missing file was first noticed missing; a file that comes back is
 * forgotten again. Returns how many files were removed.
 */
export async function pruneMirror(
  liveDir: string,
  mirrorDir: string,
  goneFile: string,
  nowMs: number,
  skipDir: (name: string, rel: string) => boolean = () => false,
): Promise<number> {
  if (!exists(liveDir) || !exists(mirrorDir)) return 0;
  let known: Record<string, number> = {};
  try {
    const parsed = JSON.parse(await fs.promises.readFile(goneFile, "utf8"));
    if (parsed && typeof parsed === "object") known = parsed;
  } catch {
    // first run
  }
  const stillGone: Record<string, number> = {};
  let removed = 0;

  const walk = async (rel: string): Promise<boolean> => {
    const dir = path.join(mirrorDir, rel);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    let left = 0;
    for (const e of entries) {
      const childRel = rel ? path.join(rel, e.name) : e.name;
      const mirrored = path.join(mirrorDir, childRel);
      if (e.isDirectory()) {
        if (skipDir(e.name, childRel.split(path.sep).join("/"))) {
          left++;
          continue;
        }
        if (await walk(childRel)) left++;
        else await fs.promises.rmdir(mirrored).catch(() => left++);
        continue;
      }
      if (exists(path.join(liveDir, childRel))) {
        left++;
        continue;
      }
      const since = known[childRel] ?? nowMs;
      if (nowMs - since >= MIRROR_KEEP_DAYS * DAY_MS) {
        try {
          await fs.promises.chmod(mirrored, 0o666).catch(() => {});
          await fs.promises.rm(mirrored, { force: true });
          removed++;
          continue;
        } catch (error) {
          logger.warn(`could not remove old mirror file ${childRel}`, error);
        }
      }
      stillGone[childRel] = since;
      left++;
    }
    return left > 0;
  };
  await walk("");
  await fs.promises.mkdir(path.dirname(goneFile), { recursive: true });
  await fs.promises.writeFile(goneFile, JSON.stringify(stillGone));
  return removed;
}

/** A sister's folder counts as gone when it is missing or has lost both docs and .env. */
export function isHollow(folder: string): boolean {
  if (!exists(folder)) return true;
  return (
    !exists(path.join(folder, "docs")) && !exists(path.join(folder, ".env"))
  );
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

/** Clears the read-only flag on everything under a folder so it can be deleted. */
function makeWritable(dir: string) {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) makeWritable(p);
    else {
      try {
        fs.chmodSync(p, 0o666);
      } catch {
        // leave it; the delete will report it
      }
    }
  }
}

/**
 * Deletes the oldest snapshots beyond `keep`. A snapshot that cannot be removed
 * is logged and skipped: a stuck clean-up must never make the backup itself
 * count as failed (it would then rerun every minute).
 */
export function pruneSnapshots(root: string, keep = KEEP_SNAPSHOTS) {
  const all = snapshotDirs(root);
  for (const old of all.slice(0, Math.max(0, all.length - keep))) {
    const dir = path.join(root, "snapshots", old);
    try {
      makeWritable(dir);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      logger.warn(`could not remove old snapshot ${old}`, error);
    }
  }
}

export async function runBackup(ctx: BackupCtx): Promise<void> {
  const snap = path.join(ctx.root, "snapshots", dayKey(ctx.now));
  await fs.promises.mkdir(snap, { recursive: true });
  for (const t of ctx.targets) {
    if (isHollow(t.folder)) continue; // never overwrite a good backup with a hollow shell
    await copyTree(t.folder, path.join(ctx.root, "mirror", t.id), mirrorSkip);
    try {
      const removed = await pruneMirror(
        t.folder,
        path.join(ctx.root, "mirror", t.id),
        path.join(ctx.root, "mirror-gone", `${t.id}.json`),
        ctx.now.getTime(),
        mirrorSkip,
      );
      if (removed > 0) {
        logger.info(`${t.id}: removed ${removed} old file(s) from the mirror`);
      }
    } catch (error) {
      // A stuck clean-up must never make the backup itself count as failed.
      logger.warn(`${t.id}: could not tidy the mirror`, error);
    }
    // small identity snapshot: top-level small files + docs
    const tsnap = path.join(snap, t.id);
    await fs.promises.mkdir(tsnap, { recursive: true });
    for (const e of await fs.promises.readdir(t.folder, {
      withFileTypes: true,
    })) {
      if (!e.isFile()) continue;
      const s = path.join(t.folder, e.name);
      if ((await fs.promises.stat(s)).size <= SMALL_FILE) {
        await fs.promises.copyFile(s, path.join(tsnap, e.name));
      }
    }
    if (exists(path.join(t.folder, "docs"))) {
      await fs.promises.cp(
        path.join(t.folder, "docs"),
        path.join(tsnap, "docs"),
        { recursive: true, force: true },
      );
    }
    if (exists(t.memoryDir)) {
      await fs.promises.cp(
        t.memoryDir,
        path.join(snap, "agent-memory", path.basename(t.memoryDir)),
        { recursive: true, force: true },
      );
    }
  }
  if (exists(ctx.houseDir)) {
    await fs.promises.cp(ctx.houseDir, path.join(snap, "house"), {
      recursive: true,
      force: true,
    });
  }
  let databaseCopied = false;
  if (ctx.copyDatabase) {
    try {
      await ctx.copyDatabase(path.join(snap, "sqlite.db"));
      databaseCopied = true;
    } catch (error) {
      logger.warn(
        "consistent database copy failed; copying the raw files instead",
        error,
      );
    }
  }
  const rawFiles = databaseCopied ? [] : (ctx.databaseFiles ?? []);
  for (const f of [...ctx.extraFiles, ...rawFiles]) {
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
export async function runBackupEverywhere(
  ctx: BackupCtx,
): Promise<{ also: boolean }> {
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
export async function restoreTarget(
  ctx: BackupCtx,
  t: BackupTarget,
): Promise<boolean> {
  const mirror = path.join(ctx.root, "mirror", t.id);
  if (!exists(path.join(mirror, "docs")) && !exists(path.join(mirror, ".env")))
    return false;
  await copyTree(mirror, t.folder, mirrorSkip);
  const snaps = snapshotDirs(ctx.root);
  const latest = snaps[snaps.length - 1];
  if (latest) {
    const memSrc = path.join(
      ctx.root,
      "snapshots",
      latest,
      "agent-memory",
      path.basename(t.memoryDir),
    );
    if (
      exists(memSrc) &&
      (!exists(t.memoryDir) || fs.readdirSync(t.memoryDir).length === 0)
    ) {
      await fs.promises.cp(memSrc, t.memoryDir, {
        recursive: true,
        force: true,
      });
    }
  }
  return true;
}

const tellTim = (text: string) => sendTelegramNotice(text);

/** After a failed nightly backup, wait this long before trying again. */
export const BACKUP_RETRY_MS = 60 * 60_000;

/**
 * A backup that failed is not retried every minute (that would re-copy
 * gigabytes over and over, worst of all when the disk is nearly full): it waits
 * an hour. `failedAt` is when the last attempt failed, or null.
 */
export function mayTryBackup(failedAt: number | null, now: number): boolean {
  return failedAt === null || now - failedAt >= BACKUP_RETRY_MS;
}

function buildCtx(): BackupCtx {
  const dataDir = getUserDataPath();
  const documents =
    getElectron()?.app.getPath("documents") ??
    path.join(dataDir, "..", "Documents");
  let root = path.join(documents, "cb-backups", "nightly");
  let also: string | undefined;
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(houseDir(), "backup.json"), "utf8"),
    );
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
    extraFiles: [],
    databaseFiles: ["sqlite.db", "sqlite.db-wal", "sqlite.db-shm"].map((n) =>
      path.join(dataDir, n),
    ),
    copyDatabase: async (destFile) => {
      // Loaded here, not at the top, so this file stays light to import.
      const { getDb } = await import("@/db");
      await getDb().$client.backup(destFile);
    },
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
  let failedAt: number | null = null;

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
        last =
          JSON.parse(fs.readFileSync(statePath(ctx.root), "utf8")).lastRun ??
          "";
      } catch {
        // never run
      }
      const noMirror = ctx.targets.some(
        (t) => !exists(path.join(ctx.root, "mirror", t.id)),
      );
      const today = dayKey(ctx.now);
      if (
        last !== today &&
        (ctx.now.getHours() >= 4 || noMirror) &&
        mayTryBackup(failedAt, Date.now())
      ) {
        try {
          await runBackupEverywhere(ctx);
          fs.mkdirSync(ctx.root, { recursive: true });
          fs.writeFileSync(
            statePath(ctx.root),
            JSON.stringify({ lastRun: today, at: new Date().toISOString() }),
          );
          failedAt = null;
          logger.info("nightly backup done");
        } catch (error) {
          failedAt = Date.now();
          logger.error("nightly backup failed; trying again in an hour", error);
          const why = error instanceof Error ? error.message : String(error);
          await noticeOncePerDay(
            "nightly-backup-failed",
            `Warning: tonight's backup of the house failed (${why.slice(0, 200)}). It will try again in an hour. If the disk is nearly full, that is the usual cause.`,
          );
        }
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
