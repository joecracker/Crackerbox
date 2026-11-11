import fs from "node:fs/promises";
import path from "node:path";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { AgentContext } from "./types";

/**
 * Lets read_file hand a picture to the model instead of failing with
 * "Cannot read binary file as UTF-8 text". The picture goes out the same way
 * view_preview does it: attached to the next message as an image-url part.
 */

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const MAX_IMAGE_FILE_BYTES = 25 * 1024 * 1024;
const MAX_SHOWN_WIDTH = 1600;
const RAW_PASSTHROUGH_MAX_BYTES = 4 * 1024 * 1024;

/** The image type for a path (by extension), or undefined when it is not a picture. */
export function imageMimeForPath(filePath: string): string | undefined {
  return IMAGE_MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()];
}

export interface ImageSize {
  width: number;
  height: number;
}

/** True pixel size read straight from the file header; null if unreadable. */
export function readImageSize(buf: Buffer, mime: string): ImageSize | null {
  try {
    if (mime === "image/png") {
      if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/gif") {
      if (buf.length < 10) return null;
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (mime === "image/webp") {
      if (
        buf.length < 30 ||
        buf.toString("ascii", 0, 4) !== "RIFF" ||
        buf.toString("ascii", 8, 12) !== "WEBP"
      ) {
        return null;
      }
      const chunk = buf.toString("ascii", 12, 16);
      if (chunk === "VP8X") {
        return {
          width: 1 + buf.readUIntLE(24, 3),
          height: 1 + buf.readUIntLE(27, 3),
        };
      }
      if (chunk === "VP8L") {
        const bits = buf.readUInt32LE(21);
        return {
          width: (bits & 0x3fff) + 1,
          height: ((bits >> 14) & 0x3fff) + 1,
        };
      }
      if (chunk === "VP8 ") {
        return {
          width: buf.readUInt16LE(26) & 0x3fff,
          height: buf.readUInt16LE(28) & 0x3fff,
        };
      }
      return null;
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        if (marker === 0xff) {
          i++;
          continue;
        }
        if (
          marker === 0xd8 ||
          marker === 0x01 ||
          (marker >= 0xd0 && marker <= 0xd7)
        ) {
          i += 2;
          continue;
        }
        const length = buf.readUInt16BE(i + 2);
        const isFrame =
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 &&
          marker !== 0xc8 &&
          marker !== 0xcc;
        if (isFrame) {
          return {
            height: buf.readUInt16BE(i + 5),
            width: buf.readUInt16BE(i + 7),
          };
        }
        i += 2 + length;
      }
    }
  } catch {
    // Fall through: size unknown.
  }
  return null;
}

async function loadNativeImage(): Promise<any | undefined> {
  try {
    const electron: any = await import("electron");
    return electron.nativeImage ?? electron.default?.nativeImage;
  } catch {
    return undefined;
  }
}

/** Returns the data URL to send and the width it is shown at, or null if too big to send. */
async function prepareDataUrl(
  buf: Buffer,
  mime: string,
  size: ImageSize | null,
): Promise<{ url: string; shownWidth: number | null } | null> {
  const small = !size || size.width <= MAX_SHOWN_WIDTH;
  if (small && buf.length <= RAW_PASSTHROUGH_MAX_BYTES) {
    return {
      url: `data:${mime};base64,${buf.toString("base64")}`,
      shownWidth: size?.width ?? null,
    };
  }
  const nativeImage = await loadNativeImage();
  if (nativeImage?.createFromBuffer) {
    try {
      let image = nativeImage.createFromBuffer(buf);
      if (!image.isEmpty()) {
        if (image.getSize().width > MAX_SHOWN_WIDTH) {
          image = image.resize({ width: MAX_SHOWN_WIDTH, quality: "good" });
        }
        return {
          url: `data:image/jpeg;base64,${image.toJPEG(80).toString("base64")}`,
          shownWidth: image.getSize().width,
        };
      }
    } catch {
      // Format Electron can't decode (e.g. webp/gif); handled below.
    }
  }
  return null;
}

/** Attaches the picture at `realPath` to the next message and describes it. */
export async function readImageIntoChat(params: {
  realPath: string;
  displayPath: string;
  ctx: AgentContext;
}): Promise<string> {
  const mime =
    imageMimeForPath(params.realPath) ?? imageMimeForPath(params.displayPath);
  if (!mime) {
    throw new DyadError(
      `Not a picture file: ${params.displayPath}`,
      DyadErrorKind.Validation,
    );
  }
  let stat;
  try {
    stat = await fs.stat(params.realPath);
  } catch {
    throw new DyadError(
      `File does not exist: ${params.displayPath}`,
      DyadErrorKind.NotFound,
    );
  }
  if (!stat.isFile()) {
    throw new DyadError(
      `Not a file: ${params.displayPath}`,
      DyadErrorKind.Validation,
    );
  }
  if (stat.size > MAX_IMAGE_FILE_BYTES) {
    throw new DyadError(
      `Picture is too large to attach (${Math.round(stat.size / 1048576)} MB, limit ${MAX_IMAGE_FILE_BYTES / 1048576} MB): ${params.displayPath}`,
      DyadErrorKind.Validation,
    );
  }

  const buf = await fs.readFile(params.realPath);
  const size = readImageSize(buf, mime);
  const prepared = await prepareDataUrl(buf, mime, size);
  if (!prepared) {
    throw new DyadError(
      `Picture is too large to attach as is (${Math.round(buf.length / 1024)} KB) and could not be shrunk: ${params.displayPath}`,
      DyadErrorKind.Validation,
    );
  }

  params.ctx.appendUserMessage([
    { type: "text", text: `Picture from ${params.displayPath}:` },
    { type: "image-url", url: prepared.url },
  ]);

  const dims = size ? `${size.width}x${size.height} px` : "pixel size unknown";
  const scaled =
    size && prepared.shownWidth && prepared.shownWidth < size.width
      ? ` Shown scaled down to ${prepared.shownWidth}px wide, so fine detail is smaller than the original.`
      : "";
  return `Attached ${params.displayPath} as a picture to the next message. Original size: ${dims}, ${Math.round(buf.length / 1024)} KB.${scaled}`;
}
