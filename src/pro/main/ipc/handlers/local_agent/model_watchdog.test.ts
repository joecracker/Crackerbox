import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModelWatchdog, ModelSilenceError } from "./model_watchdog";

describe("model watchdog", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("trips after the silence limit with nothing from the model", () => {
    const onTrip = vi.fn();
    const dog = createModelWatchdog(onTrip, 1000);
    dog.start();
    vi.advanceTimersByTime(999);
    expect(onTrip).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onTrip).toHaveBeenCalledTimes(1);
    expect(dog.tripped).toBe(true);
  });

  it("restarts the clock on every part", () => {
    const onTrip = vi.fn();
    const dog = createModelWatchdog(onTrip, 1000);
    dog.start();
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(900);
      dog.onPart("text-delta");
    }
    expect(onTrip).not.toHaveBeenCalled();
  });

  it("pauses while a tool runs and resumes when it reports back", () => {
    const onTrip = vi.fn();
    const dog = createModelWatchdog(onTrip, 1000);
    dog.start();
    dog.onPart("tool-call");
    vi.advanceTimersByTime(60_000);
    expect(onTrip).not.toHaveBeenCalled();
    dog.onPart("tool-result");
    vi.advanceTimersByTime(1001);
    expect(onTrip).toHaveBeenCalledTimes(1);
  });

  it("waits for every parallel tool", () => {
    const onTrip = vi.fn();
    const dog = createModelWatchdog(onTrip, 1000);
    dog.start();
    dog.onPart("tool-call");
    dog.onPart("tool-call");
    dog.onPart("tool-result");
    vi.advanceTimersByTime(60_000);
    expect(onTrip).not.toHaveBeenCalled();
    dog.onPart("tool-error");
    vi.advanceTimersByTime(1001);
    expect(onTrip).toHaveBeenCalledTimes(1);
  });

  it("does nothing after stop", () => {
    const onTrip = vi.fn();
    const dog = createModelWatchdog(onTrip, 1000);
    dog.start();
    dog.stop();
    vi.advanceTimersByTime(10_000);
    expect(onTrip).not.toHaveBeenCalled();
  });

  it("describes the silence in plain words", () => {
    expect(new ModelSilenceError(180_000).message).toContain("3 minutes");
  });
});
