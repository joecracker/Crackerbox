// The voices Pocket TTS ships with. An entity may carry one of these as its own
// voice in the house roster.
export const POCKET_VOICES = [
  ["azelma", "Azelma"],
  ["cosette", "Cosette"],
  ["eponine", "Eponine"],
  ["alba", "Alba"],
  ["fantine", "Fantine"],
  ["marius", "Marius (male)"],
  ["javert", "Javert (male)"],
  ["jean", "Jean (male)"],
] as const;

export function isPocketVoice(value: unknown): value is string {
  return POCKET_VOICES.some(([id]) => id === value);
}
