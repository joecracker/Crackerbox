// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startFreezeCatcher } from "./freeze_catcher";

describe("freeze catcher", () => {
  it("writes the main thread's stack when it stalls, and notes recovery", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freeze-catcher-"));
    const logFilePath = path.join(dir, "freeze-catcher.log");
    const infos: string[] = [];
    const stop = startFreezeCatcher({
      logFilePath,
      stallThresholdMs: 1000,
      heartbeatIntervalMs: 100,
      onInfo: (m) => infos.push(m),
    });

    await new Promise((r) => setTimeout(r, 400));

    // Deliberately freeze this thread for 3.5 seconds.
    function spinForTestFreeze() {
      const end = Date.now() + 3500;
      while (Date.now() < end) {
        // busy
      }
    }
    spinForTestFreeze();

    await new Promise((r) => setTimeout(r, 800));
    stop();

    const text = fs.readFileSync(logFilePath, "utf8");
    expect(text).toContain("STALL DETECTED");
    expect(text).toContain("spinForTestFreeze");
    expect(text).toContain("STALL ENDED");
    expect(infos.some((m) => m.includes("unresponsive"))).toBe(true);
  }, 20000);

  it("stays silent when the main thread keeps beating", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "freeze-catcher-"));
    const logFilePath = path.join(dir, "freeze-catcher.log");
    const stop = startFreezeCatcher({
      logFilePath,
      stallThresholdMs: 1000,
      heartbeatIntervalMs: 100,
    });
    await new Promise((r) => setTimeout(r, 2500));
    stop();
    expect(fs.existsSync(logFilePath)).toBe(false);
  }, 10000);
});
