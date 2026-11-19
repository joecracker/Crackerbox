import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  customVoiceId,
  customVoiceNameOf,
  isCustomVoiceName,
} from "@/shared/pocket_voices";
import {
  CUSTOM_VOICE_EXTENSIONS,
  listCustomPocketVoices,
} from "./pocket_custom_voices";

const logger = log.scope("pocket_voice_maker");

export const MAX_VOICE_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Sound files a recording can come in. */
export const VOICE_SOURCE_EXTENSIONS = [".wav", ".flac", ".mp3", ".ogg"];
/** Making the voice can include a first-time download of Pocket's cloning weights. */
const MAKE_VOICE_TIMEOUT_MS = 5 * 60_000;
/** Recordings are kept here, so a voice can be made again later. Not listed as voices. */
export const ORIGINALS_FOLDER = "originals";

export type PocketCommandRunner = (
  exe: string,
  args: string[],
) => Promise<{ ok: boolean; output: string }>;

export const runPocketCommand: PocketCommandRunner = (exe, args) =>
  new Promise((resolve) => {
    execFile(
      exe,
      args,
      { windowsHide: true, timeout: MAKE_VOICE_TIMEOUT_MS, maxBuffer: 4 << 20 },
      (error, stdout, stderr) =>
        resolve({ ok: !error, output: `${stdout}\n${stderr}` }),
    );
  });

const bad = (message: string) =>
  new DyadError(message, DyadErrorKind.Validation);

const UNLOCK_HINT =
  "Voice cloning is not unlocked on this PC yet. Accept the terms at huggingface.co/kyutai/pocket-tts and sign in with 'hf auth login', then try again.";

/** The last few useful lines of Pocket's output, for the log. */
function tail(output: string): string {
  return output.trim().split(/\r?\n/).slice(-6).join(" | ").slice(0, 500);
}

/**
 * Turns a recording into a saved Pocket voice: the recording is kept in the
 * originals folder, and `pocket-tts export-voice` makes the .safetensors file
 * that sits in the My voices folder (it loads about twice as fast as a
 * recording, and Pocket does not have to study the sound again every reply).
 */
export async function makeCustomPocketVoice(input: {
  dir: string;
  exe: string | null;
  name: string;
  extension: string;
  bytes: Uint8Array;
  run?: PocketCommandRunner;
}): Promise<{ id: string; label: string }> {
  const name = input.name.trim();
  if (!isCustomVoiceName(name)) {
    throw bad(
      'Pick a shorter name without these characters: \\ / : * ? " < > |',
    );
  }
  const ext = ("." + input.extension.replace(/^\./, "")).toLowerCase();
  if (!VOICE_SOURCE_EXTENSIONS.includes(ext)) {
    throw bad("Use a .wav, .flac, .mp3 or .ogg recording.");
  }
  if (input.bytes.byteLength === 0) throw bad("That recording is empty.");
  if (input.bytes.byteLength > MAX_VOICE_UPLOAD_BYTES) {
    throw bad("That recording is too big. A few seconds up to 30 is plenty.");
  }
  if (!input.exe) {
    throw new DyadError(
      "Pocket is not installed on this PC, so it cannot make voices.",
      DyadErrorKind.Precondition,
    );
  }
  const taken = listCustomPocketVoices(input.dir).some(
    (v) => v.id.toLowerCase() === customVoiceId(name).toLowerCase(),
  );
  if (taken) {
    throw bad(
      `A voice called "${name}" already exists. Pick another name, or remove the old one first.`,
    );
  }

  const originals = path.join(input.dir, ORIGINALS_FOLDER);
  fs.mkdirSync(originals, { recursive: true });
  const original = path.join(originals, name + ext);
  const target = path.join(input.dir, name + ".safetensors");
  fs.writeFileSync(original, input.bytes);

  const result = await (input.run ?? runPocketCommand)(input.exe, [
    "export-voice",
    original,
    target,
  ]);
  if (!result.ok || !fs.existsSync(target)) {
    fs.rmSync(target, { force: true });
    fs.rmSync(original, { force: true });
    logger.warn(`Could not make the voice "${name}": ${tail(result.output)}`);
    if (
      /voice cloning|gated|accept the terms|huggingface/i.test(result.output)
    ) {
      throw new DyadError(UNLOCK_HINT, DyadErrorKind.Precondition);
    }
    throw new DyadError(
      "Pocket could not make a voice from that recording. Try a clearer one, 10 to 30 seconds of one person talking.",
      DyadErrorKind.External,
    );
  }
  logger.info(`Made the voice "${name}" from a ${ext} recording`);
  return { id: customVoiceId(name), label: `${name} (my voice)` };
}

/** Removes a voice and the recording it came from. Returns how many files went. */
export function deleteCustomPocketVoice(dir: string, voiceId: string): number {
  const name = customVoiceNameOf(voiceId);
  if (name === null) throw bad("That is not one of your own voices.");
  let removed = 0;
  for (const folder of [dir, path.join(dir, ORIGINALS_FOLDER)]) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      const stem = path.basename(entry.name, path.extname(entry.name));
      if (
        stem === name &&
        (CUSTOM_VOICE_EXTENSIONS.includes(ext) ||
          VOICE_SOURCE_EXTENSIONS.includes(ext))
      ) {
        fs.rmSync(path.join(folder, entry.name), { force: true });
        removed++;
      }
    }
  }
  return removed;
}
