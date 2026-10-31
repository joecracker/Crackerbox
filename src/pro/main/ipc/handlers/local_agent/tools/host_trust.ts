import path from "node:path";
import { readSettings, writeSettings } from "@/main/settings";

// Changing a file outside the project always asks, because the tool is forced
// to ask even when "Always allow" was chosen for it. "Always allow" on that
// question now means: trust this folder (and everything under it) for changes
// from then on. Files that could run by themselves, and protected folders, stay
// blocked no matter what (see host_write.ts and host_read.ts).

const MIN_FOLDER_SEGMENTS = 3; // C:\Users\me\project is the shallowest allowed

function normalize(folder: string): string {
  const resolved = path.resolve(folder);
  const trimmed = resolved.replace(/[\\/]+$/, "");
  return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

function segmentCount(folder: string): number {
  return path
    .resolve(folder)
    .split(/[\\/]+/)
    .filter((s) => s && !/^[a-z]:$/i.test(s)).length;
}

/** Whether `target` is inside one of the trusted folders. */
export function isInsideTrustedFolder(
  target: string,
  folders: readonly string[],
): boolean {
  const t = normalize(target);
  return folders.some((folder) => {
    const f = normalize(folder);
    return t === f || t.startsWith(`${f}${path.sep}`.toLowerCase());
  });
}

export function getTrustedHostFolders(): string[] {
  return readSettings().trustedHostFolders ?? [];
}

export function isTrustedHostPath(target: string): boolean {
  return isInsideTrustedFolder(target, getTrustedHostFolders());
}

/**
 * Remembers a folder as trusted. Returns false (and remembers nothing) for a
 * folder that is too broad, such as a drive or a whole user folder.
 */
export function trustHostFolder(folder: string): boolean {
  const resolved = path.resolve(folder);
  if (segmentCount(resolved) < MIN_FOLDER_SEGMENTS) return false;
  const current = getTrustedHostFolders();
  if (isInsideTrustedFolder(resolved, current)) return true;
  writeSettings({ trustedHostFolders: [...current, resolved] });
  return true;
}

export function untrustHostFolder(folder: string): void {
  const wanted = normalize(folder);
  writeSettings({
    trustedHostFolders: getTrustedHostFolders().filter(
      (f) => normalize(f) !== wanted,
    ),
  });
}
