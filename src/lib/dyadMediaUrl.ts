import { toPhoneMediaUrl } from "./phoneClient";

/**
 * Builds a dyad-media:// protocol URL for serving media files in Electron.
 * On the phone page it becomes the plain web address the phone can open.
 */
export function buildDyadMediaUrl(appPath: string, fileName: string): string {
  return toPhoneMediaUrl(
    `dyad-media://media/${encodeURIComponent(appPath)}/.dyad/media/${encodeURIComponent(fileName)}`,
  );
}

/**
 * Builds a renderer-safe media URL whose filesystem path is resolved in main.
 */
export function buildDyadMediaUrlForApp(
  appId: number,
  fileName: string,
): string {
  return toPhoneMediaUrl(
    `dyad-media://media/app-id/${appId}/.dyad/media/${encodeURIComponent(fileName)}`,
  );
}

/**
 * Builds a versioned URL for a bounded media-library thumbnail derivative.
 * The source version lets Chromium cache the derivative without showing stale
 * content after an image is replaced in place.
 */
export function buildDyadMediaThumbnailUrl(
  appPath: string,
  fileName: string,
  modifiedAtMs: number,
  sizeBytes: number,
): string {
  const url = new URL(buildDyadMediaUrl(appPath, fileName));
  url.searchParams.set("thumbnail", "1");
  url.searchParams.set("v", `${modifiedAtMs}:${sizeBytes}`);
  return url.toString();
}
