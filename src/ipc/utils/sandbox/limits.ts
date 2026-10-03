export const SANDBOX_SCRIPT_SOURCE_LIMIT_BYTES = 128 * 1024;
export const SANDBOX_LLM_OUTPUT_LIMIT_BYTES = 256 * 1024;
export const SANDBOX_UI_OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024;
export const SANDBOX_READ_FILE_LIMIT_BYTES = 20 * 1024 * 1024;

export const DEFAULT_SANDBOX_TIMEOUT_MS = 60_000;
export const MAX_SANDBOX_TIMEOUT_MS = 60_000;
export const SANDBOX_WALL_CLOCK_TIMEOUT_MS = 5 * 60_000;

// Step limits. A timer cannot stop a script that is busy running on the same
// thread, and a worker thread stuck inside the interpreter cannot be
// terminated either (verified 2026-10-02: terminate() never returned and the
// thread kept spinning). Only a finite step budget inside the interpreter
// itself stops a runaway script reliably. Measured speed on the dev laptop:
// about 26 million steps per second.
// Main thread: about 2 seconds of work, so a stuck script can never freeze
// the app for long.
export const SANDBOX_MAIN_THREAD_INSTRUCTION_BUDGET = 50_000_000;
// Worker thread: about 40 seconds, safely under the 60 second VM timeout so
// the step limit, not the timer, is what ends a runaway script.
export const SANDBOX_WORKER_INSTRUCTION_BUDGET = 1_000_000_000;
// Appears in the step-limit error text so callers can tell it from a syntax error.
export const SANDBOX_STEP_LIMIT_ERROR_MARKER = "step limit";
export const SANDBOX_HEAP_LIMIT_BYTES = 128 * 1024 * 1024;
export const SANDBOX_ALLOCATION_BUDGET = 1_000_000;
export const SANDBOX_CALL_DEPTH_LIMIT = 512;
export const SANDBOX_MAX_OUTSTANDING_HOST_CALLS = 32;

export function clampSandboxTimeoutMs(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs)) {
    return DEFAULT_SANDBOX_TIMEOUT_MS;
  }
  return Math.min(
    Math.max(Math.floor(timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS), 1),
    MAX_SANDBOX_TIMEOUT_MS,
  );
}

export function clampSandboxWallClockTimeoutMs(
  timeoutMs: number | undefined,
): number {
  if (!Number.isFinite(timeoutMs)) {
    return SANDBOX_WALL_CLOCK_TIMEOUT_MS;
  }
  return Math.min(
    Math.max(Math.floor(timeoutMs ?? SANDBOX_WALL_CLOCK_TIMEOUT_MS), 1),
    SANDBOX_WALL_CLOCK_TIMEOUT_MS,
  );
}
