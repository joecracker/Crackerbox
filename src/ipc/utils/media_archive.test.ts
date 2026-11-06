import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => "/unused",
}));

import {
  ARCHIVE_DIR_NAME,
  emptyArchive,
  getArchiveInfo,
  measureFolder,
  retireMediaFile,
} from "./media_archive";

describe("media archive", () => {
  let root: string;
  let archive: string;
  let appPath: string;
  let media: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "media-archive-"));
    archive = path.join(root, ARCHIVE_DIR_NAME);
    appPath = path.join(root, "my-app");
    media = path.join(appPath, ".dyad", "media");
    await fs.mkdir(media, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("moves a picture into a per-app archive folder", async () => {
    const file = path.join(media, "a.png");
    await fs.writeFile(file, "pic");
    const dest = await retireMediaFile(file, appPath, archive);
    expect(dest).toBe(path.join(archive, "my-app", "a.png"));
    await expect(fs.access(file)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(dest, "utf8")).toBe("pic");
  });

  it("never overwrites a picture already archived under that name", async () => {
    const first = path.join(media, "a.png");
    await fs.writeFile(first, "one");
    const d1 = await retireMediaFile(first, appPath, archive);
    await fs.writeFile(first, "two");
    const d2 = await retireMediaFile(first, appPath, archive);
    expect(d2).not.toBe(d1);
    expect(await fs.readFile(d1, "utf8")).toBe("one");
    expect(await fs.readFile(d2, "utf8")).toBe("two");
  });

  it("reports size and count, and a missing folder counts as empty", async () => {
    expect(await measureFolder(path.join(root, "nope"))).toEqual({
      bytes: 0,
      fileCount: 0,
    });
    const file = path.join(media, "a.png");
    await fs.writeFile(file, "12345");
    await retireMediaFile(file, appPath, archive);
    const info = await getArchiveInfo(archive);
    expect(info).toMatchObject({ bytes: 5, fileCount: 1, path: archive });
  });

  it("empties the archive but keeps the folder", async () => {
    const file = path.join(media, "a.png");
    await fs.writeFile(file, "12345");
    await retireMediaFile(file, appPath, archive);
    const removed = await emptyArchive(archive);
    expect(removed).toEqual({ bytes: 5, fileCount: 1 });
    expect(await fs.readdir(archive)).toEqual([]);
  });

  it("refuses to empty any folder that is not named like the archive", async () => {
    await expect(emptyArchive(root)).rejects.toThrow(/not the archive/);
  });
});
