import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dbMocks = vi.hoisted(() => {
  const from = vi.fn();
  return { select: vi.fn(() => ({ from })), from };
});

const userData = vi.hoisted(() => ({ dir: "" }));

vi.mock("electron-log", () => ({
  default: { scope: () => ({ log: vi.fn(), warn: vi.fn() }) },
}));

vi.mock("@/db", () => ({ db: { select: dbMocks.select } }));
vi.mock("@/db/schema", () => ({ apps: { path: "path" } }));
vi.mock("@/paths/paths", () => ({
  getDyadAppPath: (appPath: string) => appPath,
  getUserDataPath: () => userData.dir,
}));
vi.mock("@/ipc/utils/media_path_utils", async () => {
  const actual = await vi.importActual<
    typeof import("@/ipc/utils/media_path_utils")
  >("@/ipc/utils/media_path_utils");
  return { ...actual };
});

import { cleanupOldMediaFiles } from "@/ipc/utils/media_cleanup";
import {
  ATTACHMENTS_MANIFEST_FILE,
  DYAD_MEDIA_DIR_NAME,
} from "@/ipc/utils/media_path_utils";

describe("cleanupOldMediaFiles filesystem safety", () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    vi.useRealTimers();
    dbMocks.from.mockReset();
    await Promise.all(
      tempDirectories
        .splice(0)
        .map((directory) => fs.rm(directory, { recursive: true, force: true })),
    );
  });

  it("does not touch external files through a symlinked media directory", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-media-"));
    tempDirectories.push(root);
    const appPath = path.join(root, "app");
    const externalPath = path.join(root, "external");
    await fs.mkdir(path.join(appPath, ".dyad"), { recursive: true });
    await fs.mkdir(externalPath);
    const externalFile = path.join(externalPath, "old-secret.txt");
    await fs.writeFile(externalFile, "do not delete");
    await fs.utimes(externalFile, new Date(2020, 0), new Date(2020, 0));
    await fs.symlink(externalPath, path.join(appPath, DYAD_MEDIA_DIR_NAME));
    dbMocks.from.mockResolvedValue([{ path: appPath }]);

    await cleanupOldMediaFiles();

    await expect(fs.readFile(externalFile, "utf8")).resolves.toBe(
      "do not delete",
    );
  });

  it("moves stale media to the archive, keeps fresh media, and prunes the manifest", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-media-"));
    tempDirectories.push(root);
    const appPath = path.join(root, "app");
    const mediaPath = path.join(appPath, DYAD_MEDIA_DIR_NAME);
    await fs.mkdir(mediaPath, { recursive: true });
    userData.dir = path.join(root, "userdata");
    const oldFile = path.join(mediaPath, "old.png");
    const freshFile = path.join(mediaPath, "fresh.png");
    await fs.writeFile(oldFile, "old");
    await fs.writeFile(freshFile, "fresh");
    await fs.utimes(oldFile, new Date(2020, 0), new Date(2020, 0));
    await fs.utimes(
      freshFile,
      new Date("2025-01-30T00:00:00.000Z"),
      new Date("2025-01-30T00:00:00.000Z"),
    );
    await fs.writeFile(
      path.join(mediaPath, ATTACHMENTS_MANIFEST_FILE),
      JSON.stringify([
        {
          logicalName: "old.png",
          originalName: "old.png",
          storedFileName: "old.png",
          mimeType: "image/png",
          sizeBytes: 3,
          createdAt: "2020-01-01T00:00:00.000Z",
        },
        {
          logicalName: "fresh.png",
          originalName: "fresh.png",
          storedFileName: "fresh.png",
          mimeType: "image/png",
          sizeBytes: 5,
          createdAt: "2025-01-30T00:00:00.000Z",
        },
      ]),
    );
    dbMocks.from.mockResolvedValue([{ path: appPath }]);

    await cleanupOldMediaFiles();

    await expect(fs.access(oldFile)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.readFile(
        path.join(root, "userdata", "media-archive", "app", "old.png"),
        "utf8",
      ),
    ).resolves.toBe("old");
    await expect(fs.readFile(freshFile, "utf8")).resolves.toBe("fresh");
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(mediaPath, ATTACHMENTS_MANIFEST_FILE),
        "utf8",
      ),
    );
    expect(manifest).toEqual([
      expect.objectContaining({ storedFileName: "fresh.png" }),
    ]);
  });

  it("leaves pinned pictures in place however old they are", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-media-"));
    tempDirectories.push(root);
    userData.dir = path.join(root, "userdata");
    const appPath = path.join(root, "app");
    const mediaPath = path.join(appPath, DYAD_MEDIA_DIR_NAME);
    await fs.mkdir(mediaPath, { recursive: true });
    const keep = path.join(mediaPath, "keep.png");
    const drop = path.join(mediaPath, "drop.png");
    await fs.writeFile(keep, "keep");
    await fs.writeFile(drop, "drop");
    await fs.utimes(keep, new Date(2020, 0), new Date(2020, 0));
    await fs.utimes(drop, new Date(2020, 0), new Date(2020, 0));
    await fs.writeFile(
      path.join(appPath, ".dyad", "gallery-index.json"),
      JSON.stringify({ version: 1, files: { "keep.png": { pinned: true } } }),
    );
    dbMocks.from.mockResolvedValue([{ path: appPath }]);

    await cleanupOldMediaFiles();

    await expect(fs.readFile(keep, "utf8")).resolves.toBe("keep");
    await expect(fs.access(drop)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not delete the manifest through a symlink alias", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-31T00:00:00.000Z"));

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-media-"));
    tempDirectories.push(root);
    const appPath = path.join(root, "app");
    const mediaPath = path.join(appPath, DYAD_MEDIA_DIR_NAME);
    await fs.mkdir(mediaPath, { recursive: true });
    const manifestPath = path.join(mediaPath, ATTACHMENTS_MANIFEST_FILE);
    const aliasPath = path.join(mediaPath, "old.png");
    await fs.writeFile(manifestPath, "[]");
    await fs.symlink(ATTACHMENTS_MANIFEST_FILE, aliasPath);
    dbMocks.from.mockResolvedValue([{ path: appPath }]);

    await cleanupOldMediaFiles();

    await expect(fs.readFile(manifestPath, "utf8")).resolves.toBe("[]");
    await expect(fs.lstat(aliasPath)).resolves.toMatchObject({
      isSymbolicLink: expect.any(Function),
    });
  });
});
