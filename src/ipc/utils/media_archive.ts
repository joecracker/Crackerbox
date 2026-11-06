import fs from "node:fs/promises";
import path from "node:path";
import { getUserDataPath } from "@/paths/paths";

// "Archive" is where pictures go when they age out of an app's media folder.
// It sits inside Crackerbox's own data folder (next to the database and
// settings), so there is one place to carry over when moving to a new PC, and
// the Media page shows its size and can empty it. Nothing here is ever deleted
// automatically.

export const ARCHIVE_DIR_NAME = "media-archive";
/** The Media page warns once archive grows past this. */
export const ARCHIVE_WARN_BYTES = 1024 * 1024 * 1024;

export function getArchiveRoot(): string {
  return path.join(getUserDataPath(), ARCHIVE_DIR_NAME);
}

function safeFolderName(appPath: string): string {
  const base = path.basename(appPath) || "app";
  return base.replace(/[\p{Cc}<>:"/\\|?*]/gu, "_");
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Move one picture out of an app's media folder into archive. Returns where it went. */
export async function retireMediaFile(
  filePath: string,
  appPath: string,
  archiveRoot: string = getArchiveRoot(),
): Promise<string> {
  const dir = path.join(archiveRoot, safeFolderName(appPath));
  await fs.mkdir(dir, { recursive: true });

  const parsed = path.parse(filePath);
  let dest = path.join(dir, parsed.base);
  if (await exists(dest)) {
    dest = path.join(dir, `${parsed.name}-${Date.now()}${parsed.ext}`);
  }

  try {
    await fs.rename(filePath, dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    // Different drive: copy, then remove the original.
    await fs.copyFile(filePath, dest);
    try {
      await fs.unlink(filePath);
    } catch (unlinkError) {
      await fs.unlink(dest).catch(() => {});
      throw unlinkError;
    }
  }
  return dest;
}

export interface FolderSize {
  bytes: number;
  fileCount: number;
}

/** Total size and file count under a folder. A missing folder is empty. */
export async function measureFolder(dir: string): Promise<FolderSize> {
  let bytes = 0;
  let fileCount = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return { bytes, fileCount };
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await measureFolder(full);
      bytes += sub.bytes;
      fileCount += sub.fileCount;
    } else if (entry.isFile()) {
      try {
        bytes += (await fs.stat(full)).size;
        fileCount += 1;
      } catch {
        // Vanished while counting.
      }
    }
  }
  return { bytes, fileCount };
}

export async function getArchiveInfo(
  archiveRoot: string = getArchiveRoot(),
): Promise<FolderSize & { path: string }> {
  return { ...(await measureFolder(archiveRoot)), path: archiveRoot };
}

/** Delete everything inside archive (the folder itself stays). */
export async function emptyArchive(
  archiveRoot: string = getArchiveRoot(),
): Promise<FolderSize> {
  if (path.basename(archiveRoot) !== ARCHIVE_DIR_NAME) {
    throw new Error(
      "Refusing to empty a folder that is not the archive folder.",
    );
  }
  const before = await measureFolder(archiveRoot);
  let children: string[];
  try {
    children = await fs.readdir(archiveRoot);
  } catch {
    return { bytes: 0, fileCount: 0 };
  }
  await Promise.all(
    children.map((name) =>
      fs.rm(path.join(archiveRoot, name), { recursive: true, force: true }),
    ),
  );
  return before;
}
