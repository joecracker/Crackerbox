// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron-log", () => ({
  default: { scope: () => ({ info() {}, warn() {}, error() {} }) },
}));

import {
  deleteCustomPocketVoice,
  makeCustomPocketVoice,
  type PocketCommandRunner,
} from "./pocket_voice_maker";
import { listCustomPocketVoices } from "./pocket_custom_voices";

let dir = "";
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-voicemaker-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const sound = new Uint8Array([1, 2, 3, 4]);
/** Pretends to be `pocket-tts export-voice <in> <out>`: writes the output file. */
const goodRunner: PocketCommandRunner = async (_exe, args) => {
  fs.writeFileSync(args[2], "voice");
  return { ok: true, output: "" };
};

const make = (
  over: Partial<Parameters<typeof makeCustomPocketVoice>[0]> = {},
) =>
  makeCustomPocketVoice({
    dir,
    exe: "pocket-tts.exe",
    name: "Grandma",
    extension: ".wav",
    bytes: sound,
    run: goodRunner,
    ...over,
  });

describe("makeCustomPocketVoice", () => {
  it("keeps the recording in originals and puts the saved voice in the folder", async () => {
    const run = vi.fn(goodRunner);
    const made = await make({ run });
    expect(made).toEqual({
      id: "custom:Grandma",
      label: "Grandma (my voice)",
    });
    expect(run.mock.calls[0][1][0]).toBe("export-voice");
    expect(fs.existsSync(path.join(dir, "originals", "Grandma.wav"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(dir, "Grandma.safetensors"))).toBe(true);
    // the originals folder is not a voice, the saved voice is
    expect(listCustomPocketVoices(dir).map((v) => v.id)).toEqual([
      "custom:Grandma",
    ]);
  });

  it("refuses bad names, bad files, empty or huge recordings, and a taken name", async () => {
    await expect(make({ name: "a/b" })).rejects.toThrow(/shorter name/);
    await expect(make({ name: "   " })).rejects.toThrow(/shorter name/);
    await expect(make({ extension: ".exe" })).rejects.toThrow(/\.wav/);
    await expect(make({ bytes: new Uint8Array(0) })).rejects.toThrow(/empty/);
    await expect(
      make({ bytes: new Uint8Array(26 * 1024 * 1024) }),
    ).rejects.toThrow(/too big/);
    await expect(make({ exe: null })).rejects.toThrow(/not installed/);
    await make();
    await expect(make({ name: "grandma" })).rejects.toThrow(/already exists/);
  });

  it("explains the one-time unlock when Pocket says cloning is locked, and leaves nothing behind", async () => {
    const run: PocketCommandRunner = async () => ({
      ok: false,
      output:
        "ValueError: We could not download the weights for the model with voice cloning",
    });
    await expect(make({ run })).rejects.toThrow(/not unlocked/);
    expect(fs.readdirSync(path.join(dir, "originals"))).toEqual([]);
    expect(fs.existsSync(path.join(dir, "Grandma.safetensors"))).toBe(false);
  });

  it("gives a plain message for any other Pocket failure", async () => {
    const run: PocketCommandRunner = async () => ({
      ok: false,
      output: "something broke",
    });
    await expect(make({ run })).rejects.toThrow(/clearer one/);
  });
});

describe("deleteCustomPocketVoice", () => {
  it("removes the voice and its recording, and only those", async () => {
    await make();
    await make({ name: "Other" });
    expect(deleteCustomPocketVoice(dir, "custom:Grandma")).toBe(2);
    expect(listCustomPocketVoices(dir).map((v) => v.id)).toEqual([
      "custom:Other",
    ]);
    expect(fs.existsSync(path.join(dir, "originals", "Other.wav"))).toBe(true);
  });

  it("refuses an id that is not one of the user's own voices", () => {
    expect(() => deleteCustomPocketVoice(dir, "azelma")).toThrow(/not one of/);
    expect(() => deleteCustomPocketVoice(dir, "custom:../x")).toThrow(
      /not one of/,
    );
  });
});
