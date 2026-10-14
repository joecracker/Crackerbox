import { describe, expect, it, vi } from "vitest";
import {
  base64Size,
  IMAGE_FIRST_PASS_EDGE,
  IMAGE_SECOND_PASS_EDGE,
  prepareImagesForModel,
  type ImageShrinkDeps,
} from "./image_shrink";

const MB = 1_000_000;

// Pretend files by name with a size, and a thumbnailer whose output size depends
// on how small it was asked to make the picture.
function fakeDeps({
  sizes,
  outputByEdge = {
    [IMAGE_FIRST_PASS_EDGE]: 600_000,
    [IMAGE_SECOND_PASS_EDGE]: 200_000,
  },
  failThumbnails = false,
  emptyThumbnails = false,
}: {
  sizes: Record<string, number>;
  outputByEdge?: Record<number, number>;
  failThumbnails?: boolean;
  emptyThumbnails?: boolean;
}) {
  const createThumbnail = vi.fn(
    async (_filePath: string, size: { width: number; height: number }) => {
      if (failThumbnails) throw new Error("no thumbnailer");
      return {
        isEmpty: () => emptyThumbnails,
        getSize: () => size,
        toJPEG: () => Buffer.alloc(outputByEdge[size.width] ?? 100_000, 1),
      };
    },
  );
  const deps: ImageShrinkDeps = {
    readFile: async (filePath: string) => {
      const name = filePath.split(/[\\/]/).at(-1)!;
      if (!(name in sizes)) throw new Error("ENOENT");
      return Buffer.alloc(sizes[name], 7);
    },
    createThumbnail,
  };
  return { deps, createThumbnail };
}

const jpg = (name: string) => ({
  filePath: `C:\\media\\${name}`,
  mimeType: "image/jpeg",
});

describe("prepareImagesForModel", () => {
  it("leaves small pictures untouched", async () => {
    const { deps, createThumbnail } = fakeDeps({ sizes: { "a.jpg": 800_000 } });
    const { images, notes } = await prepareImagesForModel([jpg("a.jpg")], deps);

    expect(createThumbnail).not.toHaveBeenCalled();
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ name: "a.jpg", shrunk: false });
    expect(images[0].data.length).toBe(800_000);
    expect(notes).toEqual([]);
  });

  it("shrinks a big phone photo to a JPEG of about 2560 pixels", async () => {
    const { deps, createThumbnail } = fakeDeps({ sizes: { "a.jpg": 4 * MB } });
    const { images } = await prepareImagesForModel([jpg("a.jpg")], deps);

    expect(createThumbnail).toHaveBeenCalledWith("C:\\media\\a.jpg", {
      width: IMAGE_FIRST_PASS_EDGE,
      height: IMAGE_FIRST_PASS_EDGE,
    });
    expect(images[0]).toMatchObject({ mimeType: "image/jpeg", shrunk: true });
    expect(images[0].data.length).toBe(600_000);
  });

  it("sends both of two big photos, the case that used to lose both", async () => {
    const { deps } = fakeDeps({
      sizes: { "a.jpg": 3_960_000, "b.jpg": 3_620_000 },
    });
    const { images, notes } = await prepareImagesForModel(
      [jpg("a.jpg"), jpg("b.jpg")],
      deps,
    );

    expect(images.map((i) => i.name)).toEqual(["a.jpg", "b.jpg"]);
    expect(notes).toEqual([]);
  });

  it("turns a big PNG screenshot into a JPEG", async () => {
    const { deps } = fakeDeps({ sizes: { "shot.png": 5 * MB } });
    const { images } = await prepareImagesForModel(
      [{ filePath: "C:\\media\\shot.png", mimeType: "image/png" }],
      deps,
    );

    expect(images[0].mimeType).toBe("image/jpeg");
    expect(images[0].shrunk).toBe(true);
  });

  it("shrinks harder when many pictures together are still too big", async () => {
    const names = Array.from({ length: 10 }, (_, i) => `p${i}.jpg`);
    const { deps, createThumbnail } = fakeDeps({
      sizes: Object.fromEntries(names.map((n) => [n, 4 * MB])),
    });
    const { images, notes } = await prepareImagesForModel(names.map(jpg), deps);

    // Ten at 600 KB is about 8 MB as base64, over the 6 MB budget. At 200 KB each
    // it fits.
    expect(images).toHaveLength(10);
    expect(notes).toEqual([]);
    expect(images.every((i) => i.data.length === 200_000)).toBe(true);
    expect(
      createThumbnail.mock.calls.some(
        ([, size]) => size.width === IMAGE_SECOND_PASS_EDGE,
      ),
    ).toBe(true);
  });

  it("leaves out the last pictures, and says so, when they cannot fit", async () => {
    // GIFs cannot be shrunk. Each is 3 MB (4 MB as base64) against a 6 MB budget.
    const { deps } = fakeDeps({
      sizes: { "a.gif": 3 * MB, "b.gif": 3 * MB, "c.gif": 3 * MB },
    });
    const gif = (name: string) => ({
      filePath: `C:\\media\\${name}`,
      mimeType: "image/gif",
    });
    const { images, notes } = await prepareImagesForModel(
      [gif("a.gif"), gif("b.gif"), gif("c.gif")],
      deps,
    );

    expect(images.map((i) => i.name)).toEqual(["a.gif"]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain("c.gif");
    expect(notes[1]).toContain("b.gif");
    expect(notes[0]).toContain("left out");
  });

  it("keeps the original when shrinking fails and it still fits", async () => {
    const { deps } = fakeDeps({
      sizes: { "a.jpg": 3 * MB },
      failThumbnails: true,
    });
    const { images, notes } = await prepareImagesForModel([jpg("a.jpg")], deps);

    expect(images[0]).toMatchObject({ shrunk: false, mimeType: "image/jpeg" });
    expect(images[0].data.length).toBe(3 * MB);
    expect(notes).toEqual([]);
  });

  it("keeps the original when the thumbnailer returns nothing", async () => {
    const { deps } = fakeDeps({
      sizes: { "a.jpg": 3 * MB },
      emptyThumbnails: true,
    });
    const { images } = await prepareImagesForModel([jpg("a.jpg")], deps);

    expect(images[0].shrunk).toBe(false);
  });

  it("reports a picture that cannot be read and carries on with the rest", async () => {
    const { deps } = fakeDeps({ sizes: { "good.jpg": 500_000 } });
    const { images, notes } = await prepareImagesForModel(
      [jpg("missing.jpg"), jpg("good.jpg")],
      deps,
    );

    expect(images.map((i) => i.name)).toEqual(["good.jpg"]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("missing.jpg");
  });
});

describe("base64Size", () => {
  it("matches how big base64 text is", () => {
    for (const bytes of [0, 1, 2, 3, 4, 1000, 4_153_895]) {
      expect(base64Size(bytes)).toBe(
        Buffer.alloc(bytes).toString("base64").length,
      );
    }
  });
});
