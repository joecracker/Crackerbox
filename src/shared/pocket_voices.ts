// The voices Pocket TTS ships with. An entity may carry one of these as its own
// voice in the house roster. (Pocket's catalog has more than the first eight;
// the rest are listed after them, plain names only.)
export const POCKET_VOICES = [
  ["azelma", "Azelma"],
  ["cosette", "Cosette"],
  ["eponine", "Eponine"],
  ["alba", "Alba"],
  ["fantine", "Fantine"],
  ["marius", "Marius (male)"],
  ["javert", "Javert (male)"],
  ["jean", "Jean (male)"],
  ["anna", "Anna"],
  ["vera", "Vera"],
  ["mary", "Mary"],
  ["jane", "Jane"],
  ["eve", "Eve"],
  ["charles", "Charles"],
  ["paul", "Paul"],
  ["george", "George"],
  ["michael", "Michael"],
  ["bill_boerst", "Bill Boerst"],
  ["peter_yearsley", "Peter Yearsley"],
  ["stuart_bell", "Stuart Bell"],
  ["caro_davy", "Caro Davy"],
  ["giovanni", "Giovanni"],
  ["lola", "Lola"],
  ["juergen", "Juergen"],
  ["rafael", "Rafael"],
  ["daan", "Daan"],
  ["estelle", "Estelle"],
] as const;

/** A voice made from the user's own sound file in the "My voices" folder. */
export const CUSTOM_VOICE_PREFIX = "custom:";
export const MAX_CUSTOM_VOICE_NAME = 56;

// Anything but characters a file name cannot hold, and no leading dot or space.
const CUSTOM_NAME = /^[^\\/:*?"<>|\u0000-\u001f. ][^\\/:*?"<>|\u0000-\u001f]*$/;

export function isCustomVoiceName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_CUSTOM_VOICE_NAME &&
    CUSTOM_NAME.test(name) &&
    name === name.trim()
  );
}

export function customVoiceId(name: string): string {
  return CUSTOM_VOICE_PREFIX + name;
}

export function customVoiceNameOf(id: string): string | null {
  if (!id.startsWith(CUSTOM_VOICE_PREFIX)) return null;
  const name = id.slice(CUSTOM_VOICE_PREFIX.length);
  return isCustomVoiceName(name) ? name : null;
}

export function isBuiltInPocketVoice(value: unknown): value is string {
  return POCKET_VOICES.some(([id]) => id === value);
}

export function isPocketVoice(value: unknown): value is string {
  return (
    isBuiltInPocketVoice(value) ||
    (typeof value === "string" && customVoiceNameOf(value) !== null)
  );
}
