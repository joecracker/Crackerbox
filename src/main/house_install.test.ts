// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({ userData: "" }));
vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => h.userData,
  getDyadAppPath: (p: string) => p,
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
}));

import { writeRoster } from "@/pro/main/ipc/handlers/local_agent/house";
import { postInstallWakePath, startPostInstallWake } from "./house_install";

beforeEach(() => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), "cb-wake-"));
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(h.userData, { recursive: true, force: true });
});

describe("the post-install wake", () => {
  it("is shown to Tim, not run quietly, and is used once", () => {
    writeRoster([
      {
        id: "dextra",
        name: "Dextra",
        appId: 9,
        color: "#ec4899",
        initial: "D",
      },
    ]);
    fs.writeFileSync(
      postInstallWakePath(),
      JSON.stringify({
        sisterId: "dextra",
        appId: 9,
        note: "check the cards",
        requestedAt: new Date().toISOString(),
      }),
    );
    const send = vi.fn(() => true);
    startPostInstallWake(send);
    vi.advanceTimersByTime(16_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        sisterId: "dextra",
        appId: 9,
        visible: true,
      }),
    );
    expect(fs.existsSync(postInstallWakePath())).toBe(false);
  });
});
