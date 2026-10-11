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

const FIRST =
  "This is the first sentence and it is long enough to need its own chunk of speech.";
const SECOND =
  "This is the second sentence and it is also long enough to be generated on its own.";
const CLOUD_AUDIO = { audioBase64: "AQID", mimeType: "audio/mpeg" };
const LOCAL_AUDIO = { audioBase64: "AQID", mimeType: "audio/wav" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe("playSpeech", () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    synthesizeSpeech.mockReset();
    synthesizeSpeech.mockImplementation(async () => LOCAL_AUDIO);
    vi.stubGlobal("Audio", FakeAudio);
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:speech-${FakeAudio.instances.length}`),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    stopSpeechPlayback();
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
    expect(synthesizeSpeech.mock.calls[0][0].text).toBe(FIRST);
    expect(synthesizeSpeech.mock.calls[1][0].text).toBe(SECOND);
    FakeAudio.instances[0].onended?.();
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(2));
    FakeAudio.instances[1].onended?.();
    await done;
  });

  it("keeps a reply of 3,000 characters or fewer in one cloud request", async () => {
    synthesizeSpeech.mockResolvedValue(CLOUD_AUDIO);
    const text = "Hello from Crackerbox.".repeat(100);
    const done = playSpeech({
      messageId: 2,
      text,
      voice: "af_bella",
      speed: 1.2,
      provider: "openrouter",
    });

    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(synthesizeSpeech).toHaveBeenCalledWith({
      text,
      voice: "af_bella",
      speed: 1.2,
      provider: "openrouter",
    });
    expect(FakeAudio.instances[0]).toMatchObject({
      playbackRate: 1.2,
      preservesPitch: true,
    });
    FakeAudio.instances[0].onended?.();
    await done;
  });

  it("buffers the next cloud piece while the current piece plays", async () => {
    synthesizeSpeech.mockResolvedValue(CLOUD_AUDIO);
    const firstPiece = "First cloud sentence. ".repeat(100);
    const secondPiece = "Second cloud sentence. ".repeat(100);
    const done = playSpeech({
      messageId: 3,
      text: firstPiece + secondPiece,
      voice: "af_bella",
      speed: 1,
      provider: "openrouter",
    });

    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    expect(synthesizeSpeech).toHaveBeenCalledTimes(2);
    expect(synthesizeSpeech.mock.calls[0][0]).toMatchObject({
      provider: "openrouter",
    });
    expect(synthesizeSpeech.mock.calls[1][0]).toMatchObject({
      provider: "openrouter",
    });
    expect(synthesizeSpeech.mock.calls[0][0].text.length).toBeLessThanOrEqual(
      CLOUD_CHUNK_MAX_LENGTH,
    );
    expect(synthesizeSpeech.mock.calls[1][0].text.length).toBeLessThanOrEqual(
      CLOUD_CHUNK_MAX_LENGTH,
    );
    FakeAudio.instances[0].onended?.();
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(2));
    FakeAudio.instances[1].onended?.();
    await done;
  });

  it("uses local speech with small chunks when cloud generation fails", async () => {
    synthesizeSpeech
      .mockRejectedValueOnce(new Error("cloud unavailable"))
      .mockResolvedValue(LOCAL_AUDIO);
    const done = playSpeech({
      messageId: 4,
      text: FIRST + " " + SECOND,
      voice: "af_bella",
      speed: 1,
      provider: "openrouter",
    });

    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    expect(synthesizeSpeech.mock.calls.slice(1).map((call) => call[0])).toEqual(
      [
        expect.objectContaining({ text: FIRST, provider: "local" }),
        expect.objectContaining({ text: SECOND, provider: "local" }),
      ],
    );
    expect(FakeAudio.instances[0].playbackRate).toBe(1);
    FakeAudio.instances[0].onended?.();
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(2));
    FakeAudio.instances[1].onended?.();
    await done;
  });

  it("uses local speech if cloud MP3 playback fails", async () => {
    synthesizeSpeech
      .mockResolvedValueOnce(CLOUD_AUDIO)
      .mockResolvedValue(LOCAL_AUDIO);
    const done = playSpeech({
      messageId: 5,
      text: FIRST,
      voice: "af_bella",
      speed: 1.25,
      provider: "openrouter",
    });

    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    FakeAudio.instances[0].onerror?.();
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(2));
    expect(synthesizeSpeech.mock.calls[1][0]).toMatchObject({
      text: FIRST,
      provider: "local",
    });
    expect(FakeAudio.instances[1].playbackRate).toBe(1);
    FakeAudio.instances[1].onended?.();
    await done;
  });

  it("falls back from the failed second cloud piece without replaying the first", async () => {
    const firstPiece = "First cloud sentence. ".repeat(100);
    const secondPiece = "Second cloud sentence. ".repeat(100);
    synthesizeSpeech
      .mockResolvedValueOnce(CLOUD_AUDIO)
      .mockRejectedValueOnce(new Error("second cloud request failed"))
      .mockResolvedValue(LOCAL_AUDIO);
    const done = playSpeech({
      messageId: 6,
      text: firstPiece + secondPiece,
      voice: "af_bella",
      speed: 1,
      provider: "openrouter",
    });

    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    const firstCloudText = synthesizeSpeech.mock.calls[0][0].text;
    FakeAudio.instances[0].onended?.();
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(2));
    const localText = synthesizeSpeech.mock.calls[2][0].text;
    expect(localText).not.toContain(firstCloudText);
    expect(synthesizeSpeech.mock.calls[2][0].provider).toBe("local");
    stopSpeechPlayback();
    await done;
  });

  it("does not start local fallback after playback is stopped", async () => {
    const cloud = deferred<typeof CLOUD_AUDIO>();
    synthesizeSpeech.mockImplementationOnce(() => cloud.promise);
    const done = playSpeech({
      messageId: 7,
      text: FIRST,
      voice: "af_bella",
      speed: 1,
      provider: "openrouter",
    });

    stopSpeechPlayback();
    cloud.reject(new Error("cloud unavailable"));
    await done;
    expect(synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("does not start local audio when stopped during fallback generation", async () => {
    const local = deferred<typeof LOCAL_AUDIO>();
    synthesizeSpeech
      .mockRejectedValueOnce(new Error("cloud unavailable"))
      .mockImplementationOnce(() => local.promise);
    const done = playSpeech({
      messageId: 8,
      text: FIRST,
      voice: "af_bella",
      speed: 1,
      provider: "openrouter",
    });

    await vi.waitFor(() => expect(synthesizeSpeech).toHaveBeenCalledTimes(2));
    stopSpeechPlayback();
    local.resolve(LOCAL_AUDIO);
    await done;
    expect(FakeAudio.instances).toHaveLength(0);
  });
});
