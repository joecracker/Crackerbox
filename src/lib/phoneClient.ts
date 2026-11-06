// Helpers for when Crackerbox is opened from a phone (the "phone access"
// page). On the phone, the desktop's own pop-up windows (Save As, clipboard,
// Explorer) would open on the PC, so pictures are shared, saved or copied
// with the phone's own tools instead.

// Must match PHONE_MEDIA_PATH_PREFIX in src/main/phone_bridge_media.ts.
const PHONE_MEDIA_PATH_PREFIX = "/__phone_bridge/media/";
const DYAD_MEDIA_PREFIX = "dyad-media://media/";

/** True only inside the phone page (its shim sets this flag). */
export function isPhoneClient(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      (window as unknown as { __cbPhone?: boolean }).__cbPhone === true
    );
  } catch {
    return false;
  }
}

/**
 * dyad-media:// only works inside the desktop window. A phone browser needs
 * the plain web address the phone page serves the same pictures on.
 */
export function toPhoneMediaUrl(url: string): string {
  if (!isPhoneClient() || !url.startsWith(DYAD_MEDIA_PREFIX)) return url;
  return (
    window.location.origin +
    PHONE_MEDIA_PATH_PREFIX +
    url.slice(DYAD_MEDIA_PREFIX.length)
  );
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function mimeFromFileName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

async function fetchPictureBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load the picture (status ${response.status})`);
  }
  return response.blob();
}

/**
 * Opens the phone's share sheet with the picture (so it can go straight to
 * Messages, email, etc.). If the phone can't share files, downloads it.
 */
export async function shareOrDownloadPicture(
  url: string,
  fileName: string,
): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await fetchPictureBlob(url);
  const type = blob.type || mimeFromFileName(fileName);
  const file = new File([blob], fileName, { type });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: fileName });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      // Any other sharing problem: fall back to a plain download below.
    }
  }
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  return "downloaded";
}

/** Puts the picture on the phone's clipboard (as a PNG, which phones accept). */
export async function copyPictureToClipboard(url: string): Promise<void> {
  let blob = await fetchPictureBlob(url);
  if (blob.type !== "image/png") {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the picture to copy");
    context.drawImage(bitmap, 0, 0);
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error("Could not prepare the picture to copy")),
        "image/png",
      ),
    );
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
