// @vitest-environment node
import os from "node:os";
import { describe, expect, it } from "vitest";
import { executeSandboxScriptInProcess } from "./execution";
import {
  SANDBOX_MAIN_THREAD_INSTRUCTION_BUDGET,
  SANDBOX_WORKER_INSTRUCTION_BUDGET,
} from "./limits";

const RUNAWAY = "let i = 0; while (true) { i = i + 1; }";

describe("sandbox step limit", () => {
  it("has a finite budget on both paths, worker larger than main", () => {
    expect(Number.isSafeInteger(SANDBOX_MAIN_THREAD_INSTRUCTION_BUDGET)).toBe(
      true,
    );
    expect(SANDBOX_MAIN_THREAD_INSTRUCTION_BUDGET).toBeLessThan(
      SANDBOX_WORKER_INSTRUCTION_BUDGET,
    );
    expect(SANDBOX_WORKER_INSTRUCTION_BUDGET).toBeLessThan(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("stops a runaway script on the default (main thread) path instead of hanging", async () => {
    const t0 = Date.now();
    await expect(
      executeSandboxScriptInProcess({ appPath: os.tmpdir(), script: RUNAWAY }),
    ).rejects.toThrow(/step limit/);
    expect(Date.now() - t0).toBeLessThan(15_000);
  }, 30_000);

  it("tells the model to use the worker when the main-thread limit is hit", async () => {
    await expect(
      executeSandboxScriptInProcess({ appPath: os.tmpdir(), script: RUNAWAY }),
    ).rejects.toThrow(/execution_thread 'worker'/);
  }, 30_000);

  it("honours an explicit small budget", async () => {
    const t0 = Date.now();
    await expect(
      executeSandboxScriptInProcess({
        appPath: os.tmpdir(),
        script: RUNAWAY,
        instructionBudget: 1_000_000,
      }),
    ).rejects.toThrow(/step limit \(1,000,000 steps\)/);
    expect(Date.now() - t0).toBeLessThan(5_000);
  }, 15_000);

  it("still runs a normal script to completion", async () => {
    const result = await executeSandboxScriptInProcess({
      appPath: os.tmpdir(),
      script:
        "let total = 0; for (let i = 0; i < 1000; i = i + 1) { total = total + i; } total;",
    });
    expect(result.value).toContain("499500");
  });
});
