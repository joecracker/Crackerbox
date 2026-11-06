import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  galleryIndexPath,
  moveMediaMeta,
  normalizeSection,
  patchMediaMeta,
  readMediaMeta,
  removeMediaMeta,
  renameMediaMeta,
} from "./media_gallery_index";

describe("media gallery index", () => {
  let root: string;
  let appA: string;
  let appB: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "gallery-index-"));
    appA = path.join(root, "a");
    appB = path.join(root, "b");
    await fs.mkdir(appA, { recursive: true });
    await fs.mkdir(appB, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("starts empty and survives a broken index file", async () => {
    expect(await readMediaMeta(appA)).toEqual({});
    await fs.mkdir(path.join(appA, ".dyad"), { recursive: true });
    await fs.writeFile(galleryIndexPath(appA), "{ not json");
    expect(await readMediaMeta(appA)).toEqual({});
  });

  it("keeps the index outside the media folder", () => {
    expect(galleryIndexPath(appA)).toBe(
      path.join(appA, ".dyad", "gallery-index.json"),
    );
  });

  it("sets, merges and clears a section and the pin", async () => {
    await patchMediaMeta(appA, "x.png", {
      section: "  characters ",
      prompt: "p",
    });
    await patchMediaMeta(appA, "x.png", { pinned: true });
    expect((await readMediaMeta(appA))["x.png"]).toEqual({
      section: "characters",
      prompt: "p",
      pinned: true,
    });
    await patchMediaMeta(appA, "x.png", { section: null, pinned: false });
    expect((await readMediaMeta(appA))["x.png"]).toEqual({ prompt: "p" });
  });

  it("drops an entry once nothing is left in it", async () => {
    await patchMediaMeta(appA, "x.png", { pinned: true });
    await patchMediaMeta(appA, "x.png", { pinned: false });
    expect(await readMediaMeta(appA)).toEqual({});
  });

  it("follows a rename, a delete and a move", async () => {
    await patchMediaMeta(appA, "old.png", { section: "logos", engine: "e" });
    await renameMediaMeta(appA, "old.png", "new.png");
    expect(Object.keys(await readMediaMeta(appA))).toEqual(["new.png"]);

    await moveMediaMeta(appA, appB, "new.png");
    expect(await readMediaMeta(appA)).toEqual({});
    expect((await readMediaMeta(appB))["new.png"]).toMatchObject({
      section: "logos",
      engine: "e",
    });

    await removeMediaMeta(appB, "new.png");
    expect(await readMediaMeta(appB)).toEqual({});
  });

  it("does not lose notes when many writes arrive together", async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        patchMediaMeta(appA, `p${i}.png`, { section: "batch" }),
      ),
    );
    expect(Object.keys(await readMediaMeta(appA))).toHaveLength(12);
  });

  it("cleans section names", () => {
    expect(normalizeSection("a/b:c")).toBe("a b c");
    expect(normalizeSection("   ")).toBeUndefined();
    expect(normalizeSection("x".repeat(80))).toHaveLength(40);
    expect(normalizeSection(null)).toBeUndefined();
  });
});
