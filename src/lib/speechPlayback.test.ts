import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const synthesizeSpeech = vi.fn();
vi.mock("@/ipc/types", () => ({
  ipc: {
    audio: {
      synthesizeSpeech: (...args: unknown[]) => synthesizeSpeech(...args),
    },
  },
}));

import { playSpeech, stopSpeechPlayback } from "./speechPlayback";

class FakeAudio {
  static instances: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
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

describe("playSpeech", () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    synthesizeSpeech.mockReset();
    synthesizeSpeech.mockImplementation(async () => ({
      audioData: new Uint8Array([1, 2, 3]),
      mimeType: "audio/wav",
    }));
    vi.stubGlobal("Audio", FakeAudio);
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:speech"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    stopSpeechPlayback();
    vi.unstubAllGlobals();
  });

  it("starts generating the next chunk while the current one is playing", async () => {
    const done = playSpeech({
      messageId: 1,
      text: FIRST + " " + SECOND,
      voice: "af_bella",
      speed: 1,
    });

    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    // The first chunk is playing and the second was already requested.
    expect(synthesizeSpeech).toHaveBeenCalledTimes(2);
    expect(synthesizeSpeech.mock.calls[0][0].text).toBe(FIRST);
    expect(synthesizeSpeech.mock.calls[1][0].text).toBe(SECOND);

    FakeAudio.instances[0].onended?.();
    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(2));
    FakeAudio.instances[1].onended?.();
    await done;
    expect(synthesizeSpeech).toHaveBeenCalledTimes(2);
  });

  it("stops cleanly and asks for nothing more after stop is pressed", async () => {
    const done = playSpeech({
      messageId: 2,
      text: FIRST + " " + SECOND,
      voice: "af_bella",
      speed: 1,
    });

    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    stopSpeechPlayback();
    await done;
    expect(FakeAudio.instances).toHaveLength(1);
    expect(synthesizeSpeech).toHaveBeenCalledTimes(2);
  });

  it("reports a failed chunk instead of staying silent", async () => {
    synthesizeSpeech
      .mockResolvedValueOnce({
        audioData: new Uint8Array([1]),
        mimeType: "audio/wav",
      })
      .mockRejectedValueOnce(new Error("no speech"));
    const done = playSpeech({
      messageId: 3,
      text: FIRST + " " + SECOND,
      voice: "af_bella",
      speed: 1,
    });
    const outcome = done.then(
      () => "resolved",
      (error: Error) => error.message,
    );

    await vi.waitFor(() => expect(FakeAudio.instances).toHaveLength(1));
    FakeAudio.instances[0].onended?.();
    await expect(outcome).resolves.toBe("no speech");
  });
});
