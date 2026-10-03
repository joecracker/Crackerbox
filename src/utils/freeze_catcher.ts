import fs from "node:fs";
import { Worker } from "node:worker_threads";

/**
 * Freeze catcher.
 *
 * The main thread bumps a counter every second. A helper thread (which keeps
 * running even when the main thread is stuck) watches that counter. If it stops
 * moving for `stallThresholdMs`, the helper attaches to the main thread through
 * the V8 inspector, pauses it for a split second, writes its call stack to the
 * log file, and resumes it. Up to 3 samples are taken per stall, one per
 * threshold interval, so a stuck loop looks different from slow progress.
 *
 * This file must not import electron: it is tested in plain Node.
 *
 * If the main thread is blocked inside native code (not JavaScript), no JS
 * stack can be taken; the log says so, plus how much CPU the process used.
 */

export interface FreezeCatcherOptions {
  /** Full path of the log file the helper thread appends to. */
  logFilePath: string;
  /** How long the main thread must be silent before a stall is declared. */
  stallThresholdMs?: number;
  /** How often the main thread beats and the helper checks. */
  heartbeatIntervalMs?: number;
  /** Called on the main thread after it recovers from a stall. */
  onInfo?: (message: string) => void;
}

const DEFAULT_STALL_THRESHOLD_MS = 10_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000;
const MAX_LOG_BYTES = 1024 * 1024;

// Runs inside the helper thread (via eval, so no bundler setup is needed).
// Keep this free of backticks and dollar-brace sequences.
const WORKER_SOURCE = String.raw`
const { workerData, parentPort } = require("node:worker_threads");
const fs = require("node:fs");
const inspector = require("node:inspector");

const { logFilePath, thresholdMs, tickMs, sab } = workerData;
const beat = new Int32Array(sab);
const MAX_SAMPLES = 3;
const PAUSE_WAIT_MS = 3000;

function write(text) {
  try {
    fs.appendFileSync(logFilePath, new Date().toISOString() + " " + text + "\n");
  } catch (e) {
    /* nothing useful to do if the log cannot be written */
  }
}

let lastSeen = Atomics.load(beat, 0);
let lastChangeAt = Date.now();
let lastTickAt = Date.now();
let cpuAtLastChange = process.cpuUsage();
let stallActive = false;
let stallStartedAt = 0;
let samples = 0;
let lastSampleAt = 0;
let captureInFlight = false;
let session = null;

function cpuSeconds(since) {
  const d = process.cpuUsage(since);
  return ((d.user + d.system) / 1e6).toFixed(1);
}

function onPaused(message) {
  try {
    const frames = (message.params.callFrames || []).slice(0, 40).map(function (f) {
      return (
        "    at " +
        (f.functionName || "<anonymous>") +
        " (" + f.url + ":" + (f.location.lineNumber + 1) + ":" + (f.location.columnNumber + 1) + ")"
      );
    });
    const late = stallActive ? "" : " (LATE capture: the stall had already ended)";
    write("  stack sample " + samples + " of main thread" + late + ":\n" + frames.join("\n"));
  } finally {
    // Always let the main thread continue, whatever happened above.
    try { session.post("Debugger.resume"); } catch (e) {}
    try { session.post("Debugger.disable"); } catch (e) {}
    captureInFlight = false;
  }
}

function takeSample() {
  captureInFlight = true;
  samples += 1;
  lastSampleAt = Date.now();
  try {
    if (!session) {
      session = new inspector.Session();
      session.connectToMainThread();
      session.on("Debugger.paused", onPaused);
    }
    session.post("Debugger.enable", function () {
      session.post("Debugger.pause");
    });
  } catch (e) {
    write("  could not attach the inspector to the main thread: " + (e && e.message));
    captureInFlight = false;
    return;
  }
  setTimeout(function () {
    if (captureInFlight) {
      write(
        "  no JavaScript stack within " + PAUSE_WAIT_MS + "ms: the main thread is probably blocked inside native code, not JavaScript. " +
        "Process CPU used since the last heartbeat: " + cpuSeconds(cpuAtLastChange) + "s."
      );
    }
  }, PAUSE_WAIT_MS);
}

function startStall(stalledFor) {
  stallActive = true;
  stallStartedAt = lastChangeAt;
  samples = 0;
  write(
    "STALL DETECTED: main thread silent for " + Math.round(stalledFor / 1000) + "s. " +
    "Process CPU since last heartbeat: " + cpuSeconds(cpuAtLastChange) + "s. " +
    "RSS: " + Math.round(process.memoryUsage.rss() / 1048576) + " MB."
  );
  takeSample();
}

function endStall(now) {
  const ms = now - stallStartedAt;
  stallActive = false;
  write("STALL ENDED: main thread responsive again after about " + Math.round(ms / 1000) + "s.");
  parentPort.postMessage({ type: "stall-ended", ms: ms });
}

setInterval(function () {
  const now = Date.now();
  const gap = now - lastTickAt;
  lastTickAt = now;
  const current = Atomics.load(beat, 0);

  // This thread itself was starved or the computer slept: do not blame the app.
  if (gap > tickMs * 5 + 2000) {
    lastSeen = current;
    lastChangeAt = now;
    cpuAtLastChange = process.cpuUsage();
    if (stallActive) endStall(now);
    return;
  }

  if (current !== lastSeen) {
    lastSeen = current;
    lastChangeAt = now;
    cpuAtLastChange = process.cpuUsage();
    if (stallActive) endStall(now);
    return;
  }

  const stalledFor = now - lastChangeAt;
  if (!stallActive && stalledFor >= thresholdMs) {
    startStall(stalledFor);
  } else if (
    stallActive &&
    !captureInFlight &&
    samples < MAX_SAMPLES &&
    now - lastSampleAt >= thresholdMs
  ) {
    write("STALL CONTINUES: main thread still silent after " + Math.round(stalledFor / 1000) + "s.");
    takeSample();
  }
}, tickMs);
`;

let activeWorker: Worker | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

function rotateIfLarge(logFilePath: string): void {
  try {
    if (fs.statSync(logFilePath).size > MAX_LOG_BYTES) {
      fs.renameSync(logFilePath, `${logFilePath}.old`);
    }
  } catch {
    // No log yet, or it cannot be rotated: appending still works.
  }
}

/** Starts the freeze catcher. Returns a function that stops it. */
export function startFreezeCatcher(options: FreezeCatcherOptions): () => void {
  if (activeWorker) return stopFreezeCatcher;

  const stallThresholdMs =
    options.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;

  rotateIfLarge(options.logFilePath);

  const sab = new SharedArrayBuffer(4);
  const beat = new Int32Array(sab);

  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: {
      logFilePath: options.logFilePath,
      thresholdMs: stallThresholdMs,
      tickMs: heartbeatIntervalMs,
      sab,
    },
  });
  worker.unref();
  activeWorker = worker;

  worker.on("message", (message: { type?: string; ms?: number }) => {
    if (message?.type === "stall-ended") {
      options.onInfo?.(
        `Main thread was unresponsive for about ${Math.round((message.ms ?? 0) / 1000)}s. Details are in ${options.logFilePath}`,
      );
    }
  });
  worker.on("error", (error) => {
    options.onInfo?.(`Freeze catcher stopped after an error: ${error.message}`);
    activeWorker = null;
  });
  worker.on("exit", () => {
    if (activeWorker === worker) activeWorker = null;
  });

  heartbeatTimer = setInterval(() => {
    Atomics.add(beat, 0, 1);
  }, heartbeatIntervalMs);
  heartbeatTimer.unref();

  return stopFreezeCatcher;
}

export function stopFreezeCatcher(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (activeWorker) {
    void activeWorker.terminate();
    activeWorker = null;
  }
}
