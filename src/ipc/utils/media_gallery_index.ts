import fs from "node:fs/promises";
import path from "node:path";
import { withLock, withLocks } from "./lock_utils";

// One small index file per app (".dyad/gallery-index.json") that remembers, for
// each picture in ".dyad/media": its section, whether it is pinned (kept out of
// the 30-day archive), and where it came from. It lives next to the media
// folder, not inside it, so the clean-up never mistakes it for a picture.

export const GALLERY_INDEX_FILE = "gallery-index.json";
export const MAX_SECTION_LENGTH = 40;

export interface MediaMeta {
  section?: string;
  pinned?: boolean;
  prompt?: string;
  engine?: string;
  createdAt?: string;
}

export interface MediaMetaPatch {
  /** string = set, null = clear */
  section?: string | null;
  pinned?: boolean;
  prompt?: string;
  engine?: string;
  createdAt?: string;
}

interface GalleryIndex {
  version: 1;
  files: Record<string, MediaMeta>;
}

export function galleryIndexPath(appPath: string): string {
  return path.join(appPath, ".dyad", GALLERY_INDEX_FILE);
}

function lockId(appPath: string): string {
  return `gallery-index:${appPath}`;
}

/** Trim, drop characters that are bad in names, and cap the length. */
export function normalizeSection(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SECTION_LENGTH)
    .trim();
  return cleaned || undefined;
}

function cleanMeta(input: unknown): MediaMeta | null {
  if (!input || typeof input !== "object") return null;
  const m = input as Record<string, unknown>;
  const out: MediaMeta = {};
  const section = normalizeSection(
    typeof m.section === "string" ? m.section : undefined,
  );
  if (section) out.section = section;
  if (m.pinned === true) out.pinned = true;
  if (typeof m.prompt === "string" && m.prompt) {
    out.prompt = m.prompt.slice(0, 2000);
  }
  if (typeof m.engine === "string" && m.engine) out.engine = m.engine;
  if (typeof m.createdAt === "string" && m.createdAt) {
    out.createdAt = m.createdAt;
  }
  return Object.keys(out).length ? out : null;
}

async function readIndex(appPath: string): Promise<GalleryIndex> {
  try {
    const raw = await fs.readFile(galleryIndexPath(appPath), "utf8");
    const parsed = JSON.parse(raw) as { files?: Record<string, unknown> };
    const files: Record<string, MediaMeta> = {};
    for (const [name, value] of Object.entries(parsed?.files ?? {})) {
      const meta = cleanMeta(value);
      if (meta) files[name] = meta;
    }
    return { version: 1, files };
  } catch {
    // Missing or unreadable index = nothing known about any picture.
    return { version: 1, files: {} };
  }
}

async function writeIndex(appPath: string, index: GalleryIndex): Promise<void> {
  const file = galleryIndexPath(appPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(index, null, 2), "utf8");
  await fs.rename(tmp, file);
}

/** Everything the index knows about this app's pictures. Never throws. */
export async function readMediaMeta(
  appPath: string,
): Promise<Record<string, MediaMeta>> {
  return (await readIndex(appPath)).files;
}

/** Merge a change into one picture's notes. */
export async function patchMediaMeta(
  appPath: string,
  fileName: string,
  patch: MediaMetaPatch,
): Promise<void> {
  await withLock(lockId(appPath), async () => {
    const index = await readIndex(appPath);
    const current: Record<string, unknown> = { ...index.files[fileName] };
    if (patch.section !== undefined) {
      const section = normalizeSection(patch.section);
      if (section) current.section = section;
      else delete current.section;
    }
    if (patch.pinned !== undefined) {
      if (patch.pinned) current.pinned = true;
      else delete current.pinned;
    }
    if (patch.prompt !== undefined) current.prompt = patch.prompt;
    if (patch.engine !== undefined) current.engine = patch.engine;
    if (patch.createdAt !== undefined) current.createdAt = patch.createdAt;
    const next = cleanMeta(current);
    if (next) index.files[fileName] = next;
    else delete index.files[fileName];
    await writeIndex(appPath, index);
  });
}

export async function renameMediaMeta(
  appPath: string,
  fromName: string,
  toName: string,
): Promise<void> {
  await withLock(lockId(appPath), async () => {
    const index = await readIndex(appPath);
    const meta = index.files[fromName];
    if (!meta) return;
    delete index.files[fromName];
    index.files[toName] = meta;
    await writeIndex(appPath, index);
  });
}

export async function removeMediaMeta(
  appPath: string,
  fileName: string,
): Promise<void> {
  await withLock(lockId(appPath), async () => {
    const index = await readIndex(appPath);
    if (!index.files[fileName]) return;
    delete index.files[fileName];
    await writeIndex(appPath, index);
  });
}

/** Carry a picture's notes with it when it moves to another app. */
export async function moveMediaMeta(
  sourceAppPath: string,
  targetAppPath: string,
  fileName: string,
): Promise<void> {
  await withLocks([lockId(sourceAppPath), lockId(targetAppPath)], async () => {
    const source = await readIndex(sourceAppPath);
    const meta = source.files[fileName];
    if (!meta) return;
    const target = await readIndex(targetAppPath);
    target.files[fileName] = meta;
    await writeIndex(targetAppPath, target);
    delete source.files[fileName];
    await writeIndex(sourceAppPath, source);
  });
}
