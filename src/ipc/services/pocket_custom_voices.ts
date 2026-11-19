import fs from "node:fs";
import path from "node:path";
import {
  customVoiceId,
  customVoiceNameOf,
  isCustomVoiceName,
} from "@/shared/pocket_voices";

// The "My voices" folder: sound files the user drops in to make their own
// Pocket voices. A short, clean recording of one voice (a few seconds to 30)
// works; a .safetensors voice made with `pocket-tts export-voice` loads much
// faster than a sound file, which Pocket has to study again for every reply.
export const CUSTOM_VOICE_EXTENSIONS = [
  ".safetensors",
  ".wav",
  ".flac",
  ".mp3",
  ".ogg",
];

export interface CustomPocketVoice {
  /** What is saved in settings and sent to the voice engine, e.g. "custom:My Voice". */
  id: string;
  /** What the pickers show. */
  label: string;
  /** Full path of the sound file. */
  file: string;
}

function rank(ext: string): number {
  return CUSTOM_VOICE_EXTENSIONS.indexOf(ext);
}

/** Every usable voice file in the folder, by name. A .safetensors beats a sound file of the same name. */
export function listCustomPocketVoices(dir: string): CustomPocketVoice[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const best = new Map<string, { file: string; ext: string }>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (rank(ext) === -1) continue;
    const name = path.basename(entry.name, path.extname(entry.name));
    if (!isCustomVoiceName(name)) continue;
    const have = best.get(name);
    if (!have || rank(ext) < rank(have.ext)) {
      best.set(name, { file: path.join(dir, entry.name), ext });
    }
  }
  return [...best.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { file }]) => ({
      id: customVoiceId(name),
      label: `${name} (my voice)`,
      file,
    }));
}

/**
 * The file for a "custom:..." voice, or null if there is none. The path comes
 * from the folder listing, never from the text of the id, so a made-up id
 * cannot point anywhere else on the disk.
 */
export function resolveCustomPocketVoice(
  dir: string,
  voiceId: string,
): string | null {
  if (customVoiceNameOf(voiceId) === null) return null;
  return (
    listCustomPocketVoices(dir).find((v) => v.id === voiceId)?.file ?? null
  );
}
