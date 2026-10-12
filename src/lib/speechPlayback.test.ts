import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const synthesizeSpeech = vi.fn();
vi.mock("@/ipc/types", () => ({
  ipc: {
    audio: {
      synthesizeSpeech: (...args: unknown[]) => synthesizeSpeech(...args),
    },
  },
}));

import {
  CLOUD_CHUNK_MAX_LENGTH,
  CLOUD_WAIT_MS,
  playSpeech,
  stopSpeechPlayback,
} from "./speechPlayback";

class FakeAudio {
  static instances: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  playbackRate = 1;
  preservesPitch = false;
  src: string;
  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
}

type Request = {
  text: string;
  voice: string;
  speed: number;
  provider: "local" | "openrouter";
};

const FIRST =
  "This is the first sentence and it is long enough to need its own chunk of speech.";
const SECOND =
  "This is the second sentence and it is also long enough to be generated on its own.";
const CLOUD_AUDIO = { audioBase64: "AQID", mimeType: "audio/mpeg" };
const LOCAL_AUDIO = { audioBase64: "AQID", mimeType: "audio/wav" };

// Each sentence is about 62 characters, so each is its own local chunk. The
// first four (about 250 characters) are the locally spoken opening; the rest
// goes to the hosted voice.
const sentences = (count: number) =>
  Array.from(
    { length: count },
    (_, i) =>
      `Sentence number ${i + 1} is a plain sentence that is spoken out loud.`,
  );
const OPENING_SENTENCES = 4;
// Each test sentence is about 64 characters. LONG leaves about 80% of one hosted
// piece after the opening; VERY_LONG leaves about 150%, so it needs two.
const SENTENCE_LENGTH = 64;
const LONG_SENTENCES =
  OPENING_SENTENCES +
  Math.floor((CLOUD_CHUNK_MAX_LENGTH * 0.8) / SENTENCE_LENGTH);
const LONG = sentences(LONG_SENTENCES).join(" ");
const AFTER_OPENING = sentences(LONG_SENTENCES)
  .slice(OPENING_SENTENCES)
  .join(" ");
// Only two sentences would be left for the hosted voice: not worth the handoff.
const SHORT = sentences(6).join(" ");
// Long enough that what follows the opening needs two hosted requests.
const VERY_LONG_SENTENCES = sentences(
  OPENING_SENTENCES +
    Math.ceil((CLOUD_CHUNK_MAX_LENGTH * 1.5) / SENTENCE_LENGTH),
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

const requests = () => synthesizeSpeech.mock.calls.map((c) => c[0] as Request);
const callsFor = (provider: Request["provider"]) =>
  requests().filter((request) => request.provider === provider);

/** Waits for the audio at `index` to start, then lets it finish playing. */
async function endAudio(index: number) {
  await vi.waitFor(() =>
    expect(FakeAudio.instances.length).toBeGreaterThan(index),
  );
  FakeAudio.instances[index].onended?.();
}

describe("playSpeech", () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    synthesizeSpeech.mockReset();
    synthesizeSpeech.mockImplementation(async (request: Request) =>
      request.provider === "openrouter" ? CLOUD_AUDIO : LOCAL_AUDIO,
    );
    vi.stubGlobal("Audio", FakeAudio);
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:speech-${FakeAudio.instances.length}`),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    stopSpeechPlayback();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts generating the next local chunk while the current one is playing", async () => {
    const done = playSpeech({
      messageId: 1,
      text: FIRST + " " + SECOND,
      voice: "af_bella",
      speed: 1,
      provider: "local",
    });

    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    expect(synthesizeSpeech).toHaveBeenCalledTimes(2);
    expect(requests()[0].text).toBe(FIRST);
    expect(requests()[1].text).toBe(SECOND);
    await endAudio(0);
    await endAudio(1);
    await done;
  });

  it("speaks a short reply entirely with the built-in voice, even when hosted speech is selected", async () => {
    const done = playSpeech({
      messageId: 2,
      text: SHORT,
      voice: "af_bella",
      speed: 1,
      provider: "openrouter",
    });

    for (let i = 0; i < 6; i++) await endAudio(i);
    await done;
    expect(callsFor("openrouter")).toHaveLength(0);
    expect(
      callsFor("local")
        .map((request) => request.text)
        .join(" "),
    ).toBe(SHORT);
  });

  it("asks the hosted voice for the rest straight away and speaks the opening locally meanwhile", async () => {
    const cloud = deferred<typeof CLOUD_AUDIO>();
    synthesizeSpeech.mockImplementation(async (request: Request) =>
      request.provider === "openrouter" ? cloud.promise : LOCAL_AUDIO,
    );
    const done = playSpeech({
      messageId: 3,
      text: LONG,
      voice: "af_bella",
      speed: 1.2,
      provider: "openrouter",
    });

    // The hosted request is the very first thing sent, before any audio plays.
    expect(requests()[0]).toMatchObject({
      provider: "openrouter",
      text: AFTER_OPENING,
    });
    for (let i = 0; i < OPENING_SENTENCES; i++) await endAudio(i);
    cloud.resolve(CLOUD_AUDIO);
    await endAudio(OPENING_SENTENCES);
    await done;

    expect(callsFor("local").map((request) => request.text)).toEqual(
      sentences(OPENING_SENTENCES),
    );
    // Local audio plays at normal rate; the hosted recording uses the speed.
    expect(FakeAudio.instances).toHaveLength(OPENING_SENTENCES + 1);
    expect(FakeAudio.instances[0].playbackRate).toBe(1);
    expect(FakeAudio.instances[OPENING_SENTENCES]).toMatchObject({
      playbackRate: 1.2,
      preservesPitch: true,
    });
  });

  it("carries on with the built-in voice if the hosted voice is still not ready after the opening", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const cloud = deferred<typeof CLOUD_AUDIO>();
    synthesizeSpeech.mockImplementation(async (request: Request) =>
      request.provider === "openrouter" ? cloud.promise : LOCAL_AUDIO,
    );
    const done = playSpeech({
      messageId: 4,
      text: LONG,
      voice: "af_bella",
      speed: 1,
      provider: "openrouter",
    });

    for (let i = 0; i < OPENING_SENTENCES; i++) await endAudio(i);
    await vi.advanceTimersByTimeAsync(CLOUD_WAIT_MS);
    await vi.waitFor(() =>
      expect(FakeAudio.instances.length).toBeGreaterThan(OPENING_SENTENCES),
    );
    expect(callsFor("local")[OPENING_SENTENCES].text).toBe(
      sentences(30)[OPENING_SENTENCES],
    );
    stopSpeechPlayback();
    await done;
  });

  it("continues with the built-in voice when the hosted voice fails, without repeating the opening", async () => {
    synthesizeSpeech.mockImplementation(async (request: Request) => {
      if (request.provider === "openrouter") throw new Error("cloud down");
      return LOCAL_AUDIO;
    });
    const done = playSpeech({
      messageId: 5,
      text: LONG,
      voice: "af_bella",
      speed: 1,
      provider: "openrouter",
    });

    for (let i = 0; i < LONG_SENTENCES; i++) await endAudio(i);
    await done;
    expect(
      callsFor("local")
        .map((request) => request.text)
        .join(" "),
    ).toBe(LONG);
  });

  it("uses the built-in voice if the hosted MP3 cannot be played", async () => {
    const done = playSpeech({
      messageId: 6,
      text: LONG,
      voice: "af_bella",
      speed: 1.25,
      provider: "openrouter",
    });

    for (let i = 0; i < OPENING_SENTENCES; i++) await endAudio(i);
    await vi.waitFor(() =>
      expect(FakeAudio.instances).toHaveLength(OPENING_SENTENCES + 1),
    );
    FakeAudio.instances[OPENING_SENTENCES].onerror?.();
    await vi.waitFor(() =>
      expect(FakeAudio.instances).toHaveLength(OPENING_SENTENCES + 2),
    );
    expect(callsFor("local")[OPENING_SENTENCES].text).toBe(
      sentences(30)[OPENING_SENTENCES],
    );
    expect(FakeAudio.instances[OPENING_SENTENCES + 1].playbackRate).toBe(1);
    stopSpeechPlayback();
    await done;
  });

  it("keeps hosted pieces small enough to come back well inside the time limit", () => {
    // Pieces of about 1,000 characters took 2 to 6 seconds; 2,500+ sometimes
    // took over the 30 second limit.
    expect(CLOUD_CHUNK_MAX_LENGTH).toBeLessThanOrEqual(1_000);
  });

  it("buffers the next hosted piece while the current piece plays", async () => {
    const done = playSpeech({
      messageId: 7,
      text: VERY_LONG_SENTENCES.join(" "),
      voice: "af_bella",
      speed: 1,
      provider: "openrouter",
    });

    for (let i = 0; i < OPENING_SENTENCES; i++) await endAudio(i);
    await vi.waitFor(() =>
      expect(FakeAudio.instances).toHaveLength(OPENING_SENTENCES + 1),
    );
    const [firstPiece, secondPiece] = callsFor("openrouter");
    expect(callsFor("openrouter")).toHaveLength(2);
    expect(firstPiece.text.length).toBeLessThanOrEqual(CLOUD_CHUNK_MAX_LENGTH);
    expect(secondPiece.text.length).toBeLessThanOrEqual(CLOUD_CHUNK_MAX_LENGTH);
    expect(firstPiece.text + " " + secondPiece.text).toBe(
      VERY_LONG_SENTENCES.slice(OPENING_SENTENCES).join(" "),
    );
    await endAudio(OPENING_SENTENCES);
    await endAudio(OPENING_SENTENCES + 1);
    await done;
  });

  it("falls back from a failed second hosted piece without repeating the first", async () => {
    let hostedCalls = 0;
    synthesizeSpeech.mockImplementation(async (request: Request) => {
      if (request.provider === "openrouter") {
        hostedCalls += 1;
        if (hostedCalls === 2) throw new Error("second piece failed");
        return CLOUD_AUDIO;
      }
      return LOCAL_AUDIO;
    });
    const done = playSpeech({
      messageId: 8,
      text: VERY_LONG_SENTENCES.join(" "),
      voice: "af_bella",
      speed: 1,
      provider: "openrouter",
    });

    for (let i = 0; i < OPENING_SENTENCES; i++) await endAudio(i);
    await endAudio(OPENING_SENTENCES);
    await vi.waitFor(() =>
      expect(FakeAudio.instances).toHaveLength(OPENING_SENTENCES + 2),
    );
    const firstPieceText = callsFor("openrouter")[0].text;
    const secondPieceText = callsFor("openrouter")[1].text;
    const fallbackText = callsFor("local")[OPENING_SENTENCES].text;
    expect(firstPieceText).not.toContain(fallbackText);
    expect(secondPieceText).toContain(fallbackText);
    stopSpeechPlayback();
    await done;
  });

  it("does not start any fallback after playback is stopped", async () => {
    const cloud = deferred<typeof CLOUD_AUDIO>();
    synthesizeSpeech.mockImplementation(async (request: Request) =>
      request.provider === "openrouter" ? cloud.promise : LOCAL_AUDIO,
    );
    const done = playSpeech({
      messageId: 9,
      text: LONG,
      voice: "af_bella",
      speed: 1,
      provider: "openrouter",
    });

    stopSpeechPlayback();
    cloud.reject(new Error("cloud unavailable"));
    await done;
    expect(FakeAudio.instances).toHaveLength(0);
    expect(callsFor("openrouter")).toHaveLength(1);
  });

  it("lets the hosted voice speak the opening if the built-in voice fails", async () => {
    synthesizeSpeech.mockImplementation(async (request: Request) => {
      if (request.provider === "local") throw new Error("voice process died");
      return CLOUD_AUDIO;
    });
    const done = playSpeech({
      messageId: 10,
      text: LONG,
      voice: "af_bella",
      speed: 1.25,
      provider: "openrouter",
    });

    await endAudio(0);
    await endAudio(1);
    await done;
    expect(callsFor("openrouter").map((request) => request.text)).toEqual([
      AFTER_OPENING,
      sentences(OPENING_SENTENCES).join(" "),
    ]);
    expect(FakeAudio.instances[0].playbackRate).toBe(1.25);
  });

  it("reports an error when neither voice can speak", async () => {
    synthesizeSpeech.mockRejectedValue(new Error("nothing works"));
    await expect(
      playSpeech({
        messageId: 11,
        text: LONG,
        voice: "af_bella",
        speed: 1,
        provider: "openrouter",
      }),
    ).rejects.toThrow("nothing works");
    expect(FakeAudio.instances).toHaveLength(0);
  });
});
