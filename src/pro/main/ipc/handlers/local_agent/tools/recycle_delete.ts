import fs from "node:fs/promises";
import path from "node:path";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/**
 * delete_file for a file that is NOT in the open project but is inside the
 * dyad-apps folder (a sister's project, the screenshots folder, ...).
 * Rules: single files only, never a link, never .dyad / .git / node_modules,
 * and the file goes to the Recycle Bin, never erased, so it can always be
 * restored. Anything outside dyad-apps is refused.
 */

const PROTECTED_SEGMENTS = new Set([".dyad", ".git", "node_modules"]);

export interface RecycleDeps {
  /** The dyad-apps folder; defaults to the app's configured apps folder. */
  appsRoot?: string;
  /** Moves a path to the Recycle Bin; defaults to Electron's shell.trashItem. */
  trash?: (target: string) => Promise<void>;
}

/** True for an absolute path that is not inside the open project. */
export function isOutsideProject(input: string, appPath: string): boolean {
  if (!input || !path.isAbsolute(input)) return false;
  const relative = path.relative(path.resolve(appPath), path.resolve(input));
  return (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

function refuse(message: string): DyadError {
  return new DyadError(message, DyadErrorKind.Validation);
}

export async function recycleDeleteInsideApps(
  inputPath: string,
  deps: RecycleDeps = {},
): Promise<string> {
  const appsRoot =
    deps.appsRoot ?? (await import("@/paths/paths")).getDyadAppsBaseDirectory();
  const trash =
    deps.trash ??
    (async (target: string) => {
      const { shell } = await import("electron");
      await shell.trashItem(target);
    });

  let realRoot: string;
  try {
    realRoot = await fs.realpath(appsRoot);
  } catch {
    throw refuse(
      "The dyad-apps folder could not be found, so nothing was deleted.",
    );
  }

  const absolute = path.resolve(inputPath);
  let stat;
  try {
    stat = await fs.lstat(absolute);
  } catch {
    throw new DyadError(
      `File does not exist: ${inputPath}`,
      DyadErrorKind.NotFound,
    );
  }
  if (stat.isSymbolicLink()) {
    throw refuse(`${inputPath} is a link or shortcut, so it was not deleted.`);
  }
  if (!stat.isFile()) {
    throw refuse(
      `${inputPath} is a folder. Outside your own project only single files can be deleted. Ask Tim.`,
    );
  }

  const real = await fs.realpath(absolute);
  const relative = path.relative(realRoot, real);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw refuse(
      `${inputPath} is outside the dyad-apps folder. delete_file only reaches files inside your project or inside dyad-apps. Ask Tim.`,
    );
  }
  const segments = relative.split(path.sep).map((s) => s.toLowerCase());
  if (segments.some((segment) => PROTECTED_SEGMENTS.has(segment))) {
    throw refuse(
      `${inputPath} is inside .dyad, .git or node_modules, which are never deleted from outside the project. Ask Tim.`,
    );
  }

  await trash(real);
  return `Moved ${inputPath} to the Recycle Bin. Nothing was erased; Tim can restore it from the Recycle Bin.`;
}
