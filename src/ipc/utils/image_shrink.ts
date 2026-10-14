import path from "node:path";
import { readFile } from "node:fs/promises";
import { createPlatformThumbnailFromPath } from "./media_thumbnail";

// Phone photos are far bigger than a model needs. A 4000x3000 photo is about
// 4 MB, and two of them together went past the 10 MB limit on a saved message
// (MAX_AI_MESSAGES_SIZE), so the app dropped both without telling anyone and the
// model only saw the words. Big pictures are shrunk before they are sent, and if
// something still does not fit, the model is told instead of being left to guess.
export const IMAGE_FIRST_PASS_EDGE = 2560;
export const IMAGE_SECOND_PASS_EDGE = 1600;
// Pictures at or under this size go through untouched.
export const IMAGE_LEAVE_ALONE_BYTES = 1_500_000;
// All pictures in one message, measured the way they are sent (base64). The
// saved message limit is 10,000,000 and the words and history need room too.
export const IMAGE_BUDGET_BASE64_BYTES = 6_000_000;
const JPEG_QUALITY = 85;

export interface ShrunkImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  toJPEG(quality: number): Buffer;
}

export interface ImageShrinkDeps {
  readFile(filePath: string): Promise<Buffer>;
  createThumbnail(
    filePath: string,
    size: { width: number; height: number },
  ): Promise<ShrunkImage>;
}

export interface PreparedImage {
  name: string;
  mimeType: string;
  data: Buffer;
  shrunk: boolean;
}

export function base64Size(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

function defaultDeps(): ImageShrinkDeps {
  return {
    readFile: (filePath) => readFile(filePath),
    createThumbnail: async (filePath, size) => {
      const { nativeImage } = await import("electron");
      // The platform thumbnailer applies a phone photo's rotation flag, so a
      // portrait shot comes out the right way up.
      const image = await createPlatformThumbnailFromPath(
        nativeImage as never,
        filePath,
        size,
      );
      return image as unknown as ShrunkImage;
    },
  };
}

interface Candidate {
  filePath: string;
  name: string;
  original: Buffer;
  data: Buffer;
  mimeType: string;
  shrunk: boolean;
  canShrink: boolean;
}

async function shrinkTo(
  candidate: Candidate,
  edge: number,
  deps: ImageShrinkDeps,
): Promise<void> {
  if (!candidate.canShrink) return;
  try {
    const image = await deps.createThumbnail(candidate.filePath, {
      width: edge,
      height: edge,
    });
    if (image.isEmpty()) return;
    const jpeg = image.toJPEG(JPEG_QUALITY);
    if (jpeg.length > 0 && jpeg.length < candidate.data.length) {
      candidate.data = jpeg;
      candidate.mimeType = "image/jpeg";
      candidate.shrunk = true;
    }
  } catch {
    // Keep the original; the budget check below decides whether it still fits.
  }
}

/**
 * Gets the attached pictures ready to send to a model: big ones are shrunk,
 * and if they still do not fit together, shrunk harder, then the last ones are
 * left out. Every picture that is left out comes back as a plain-words note.
 */
export async function prepareImagesForModel(
  files: { filePath: string; mimeType: string }[],
  deps: ImageShrinkDeps = defaultDeps(),
  budget: number = IMAGE_BUDGET_BASE64_BYTES,
): Promise<{ images: PreparedImage[]; notes: string[] }> {
  const notes: string[] = [];
  const candidates: Candidate[] = [];

  for (const file of files) {
    const name = path.basename(file.filePath);
    try {
      const original = await deps.readFile(file.filePath);
      candidates.push({
        filePath: file.filePath,
        name,
        original,
        data: original,
        mimeType: file.mimeType,
        shrunk: false,
        canShrink:
          file.mimeType === "image/jpeg" || file.mimeType === "image/png",
      });
    } catch {
      notes.push(
        `The picture "${name}" could not be read, so it was left out.`,
      );
    }
  }

  const total = () =>
    candidates.reduce((sum, c) => sum + base64Size(c.data.length), 0);

  for (const candidate of candidates) {
    if (candidate.data.length > IMAGE_LEAVE_ALONE_BYTES) {
      await shrinkTo(candidate, IMAGE_FIRST_PASS_EDGE, deps);
    }
  }
  if (total() > budget) {
    for (const candidate of candidates) {
      await shrinkTo(candidate, IMAGE_SECOND_PASS_EDGE, deps);
    }
  }
  while (candidates.length > 0 && total() > budget) {
    const dropped = candidates.pop()!;
    notes.push(
      `The picture "${dropped.name}" was left out because the pictures together were too large to send.`,
    );
  }

  return {
    images: candidates.map((c) => ({
      name: c.name,
      mimeType: c.mimeType,
      data: c.data,
      shrunk: c.shrunk,
    })),
    notes,
  };
}
