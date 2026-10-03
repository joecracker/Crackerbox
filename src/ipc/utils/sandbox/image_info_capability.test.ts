// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildSandboxCapabilitiesWithObserver,
  SANDBOX_HOST_CALL_NAMES,
  sandboxImageInfo,
} from "./capabilities";
import { executeSandboxScriptInProcess } from "./execution";

function tinyPng(width: number, height: number): Buffer {
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32(13),
    Buffer.from("IHDR", "latin1"),
    u32(width),
    u32(height),
    Buffer.from([8, 6, 0, 0, 0]),
  ]);
}

describe("image_info host function", () => {
  let root: string;
  let appDir: string;
  const png = tinyPng(640, 480);

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "image-info-"));
    appDir = path.join(root, "app");
    fs.mkdirSync(appDir);
    fs.writeFileSync(path.join(appDir, "pic.png"), png);
    fs.writeFileSync(path.join(appDir, "notes.txt"), "not an image at all");
    fs.writeFileSync(path.join(root, "outside.png"), tinyPng(1, 1));
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("is registered as a host function", () => {
    expect(SANDBOX_HOST_CALL_NAMES).toContain("image_info");
  });

  it("returns format, size in pixels and file size", async () => {
    await expect(sandboxImageInfo(appDir, "pic.png")).resolves.toEqual({
      format: "png",
      width: 640,
      height: 480,
      size: png.length,
    });
  });

  it("rejects a file that is not a supported image", async () => {
    await expect(sandboxImageInfo(appDir, "notes.txt")).rejects.toThrow(
      /could not read the size/,
    );
  });

  it("rejects a missing file and a directory", async () => {
    await expect(sandboxImageInfo(appDir, "missing.png")).rejects.toThrow();
    await expect(sandboxImageInfo(appDir, ".")).rejects.toThrow();
  });

  it("refuses paths outside the app", async () => {
    await expect(sandboxImageInfo(appDir, "../outside.png")).rejects.toThrow();
  });

  it("is in the capability map and reports the call to the observer", async () => {
    const observer = vi.fn();
    const caps = buildSandboxCapabilitiesWithObserver(appDir, observer);
    await expect(caps.image_info("pic.png")).resolves.toMatchObject({
      width: 640,
      height: 480,
    });
    expect(observer).toHaveBeenCalledWith({
      name: "image_info",
      path: "pic.png",
    });
    expect(() => caps.image_info(123 as unknown)).toThrow(/must be a string/);
  });

  it("works from inside a script, instantly", async () => {
    const t0 = Date.now();
    const result = await executeSandboxScriptInProcess({
      appPath: appDir,
      script:
        'const info = await image_info("pic.png"); ({ w: info.width, h: info.height, f: info.format });',
    });
    expect(JSON.parse(result.value)).toEqual({ w: 640, h: 480, f: "png" });
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});
