import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isOutsideProject, recycleDeleteInsideApps } from "./recycle_delete";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

describe("recycleDeleteInsideApps", () => {
  let root: string;
  let outside: string;
  const trash = vi.fn(async () => {});

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "recycle-apps-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "recycle-outside-"));
    fs.mkdirSync(path.join(root, "nyx", ".dyad"), { recursive: true });
    fs.mkdirSync(path.join(root, "nyx", "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "nyx", "src", "a.txt"), "a");
    fs.writeFileSync(path.join(root, "nyx", ".dyad", "chat.md"), "c");
    fs.writeFileSync(path.join(root, "loose.txt"), "l");
    fs.writeFileSync(path.join(outside, "x.txt"), "x");
    trash.mockClear();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("sends a file inside the apps folder to the Recycle Bin", async () => {
    const file = path.join(root, "loose.txt");
    const result = await recycleDeleteInsideApps(file, {
      appsRoot: root,
      trash,
    });
    expect(trash).toHaveBeenCalledTimes(1);
    expect(result).toContain("Recycle Bin");
    expect(fs.existsSync(file)).toBe(true); // trash is mocked: nothing erased here
  });

  it("works for a file in another project folder", async () => {
    const file = path.join(root, "nyx", "src", "a.txt");
    await recycleDeleteInsideApps(file, { appsRoot: root, trash });
    expect(trash).toHaveBeenCalledTimes(1);
  });

  it("refuses files outside the apps folder", async () => {
    await expect(
      recycleDeleteInsideApps(path.join(outside, "x.txt"), {
        appsRoot: root,
        trash,
      }),
    ).rejects.toThrow("outside the dyad-apps folder");
    expect(trash).not.toHaveBeenCalled();
  });

  it("refuses .dyad contents", async () => {
    await expect(
      recycleDeleteInsideApps(path.join(root, "nyx", ".dyad", "chat.md"), {
        appsRoot: root,
        trash,
      }),
    ).rejects.toThrow(".dyad");
    expect(trash).not.toHaveBeenCalled();
  });

  it("refuses folders", async () => {
    await expect(
      recycleDeleteInsideApps(path.join(root, "nyx"), {
        appsRoot: root,
        trash,
      }),
    ).rejects.toThrow("folder");
    expect(trash).not.toHaveBeenCalled();
  });

  it("reports a missing file", async () => {
    await expect(
      recycleDeleteInsideApps(path.join(root, "nope.txt"), {
        appsRoot: root,
        trash,
      }),
    ).rejects.toThrow("File does not exist");
  });
});

describe("isOutsideProject", () => {
  it("is false for relative paths and paths inside the project", () => {
    const project = path.join(os.tmpdir(), "proj");
    expect(isOutsideProject("src/a.ts", project)).toBe(false);
    expect(isOutsideProject(path.join(project, "src", "a.ts"), project)).toBe(
      false,
    );
  });

  it("is true for an absolute path elsewhere", () => {
    const project = path.join(os.tmpdir(), "proj");
    expect(
      isOutsideProject(path.join(os.tmpdir(), "other", "a.ts"), project),
    ).toBe(true);
  });
});
