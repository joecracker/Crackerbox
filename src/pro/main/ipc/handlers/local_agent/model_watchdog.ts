/**
 * Watches one model request for silence. Some providers hang without ever
 * answering or failing (seen on Venice, 2026-11-18: a scheduled greeting sat
 * silent forever). The watchdog trips when nothing has arrived from the model
 * for `silenceMs`. While a tool is running the model is rightly quiet, so the
 * clock is paused until that tool reports back.
 */
export const MODEL_SILENCE_MS = 3 * 60 * 1000;

export class ModelSilenceError extends Error {
  constructor(public readonly silenceMs: number) {
    super(
      `The model stopped answering (nothing for ${Math.round(silenceMs / 60000)} minutes).`,
    );
    this.name = "ModelSilenceError";
  }
}

export interface ModelWatchdog {
  /** Starts the clock (call just before reading the stream). */
  start(): void;
  /** Call for every part the stream produces. */
  onPart(type: string): void;
  /** Stops the clock (call when the attempt is over). */
  stop(): void;
  readonly tripped: boolean;
}

export function createModelWatchdog(
  onTrip: () => void,
  silenceMs: number = MODEL_SILENCE_MS,
): ModelWatchdog {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let toolsRunning = 0;
  let tripped = false;
  const arm = () => {
    clearTimeout(timer);
    if (tripped || toolsRunning > 0) return;
    timer = setTimeout(() => {
      tripped = true;
      onTrip();
    }, silenceMs);
  };
  return {
    start: arm,
    onPart(type) {
      if (type === "tool-call") toolsRunning++;
      else if (type === "tool-result" || type === "tool-error") {
        toolsRunning = Math.max(0, toolsRunning - 1);
      }
      arm();
    },
    stop() {
      clearTimeout(timer);
    },
    get tripped() {
      return tripped;
    },
  };
}
