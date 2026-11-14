// Temperament: how wild or straight-laced an entity is, as a model temperature.
// An entity may carry an optional `temperature` (0 to 2) in the house roster.
// When it is set, it replaces the model's own default for that entity's turns,
// except on models that cannot take a custom temperature.

export const MIN_TEMPERATURE = 0;
export const MAX_TEMPERATURE = 2;

export interface TemperamentPreset {
  id: "straight-laced" | "steady" | "default" | "playful" | "wild";
  label: string;
  /** Undefined means "leave it unset": the model's own default applies. */
  temperature: number | undefined;
}

export const TEMPERAMENT_PRESETS: readonly TemperamentPreset[] = [
  { id: "straight-laced", label: "Straight-laced", temperature: 0.3 },
  { id: "steady", label: "Steady", temperature: 0.7 },
  { id: "default", label: "Default", temperature: undefined },
  { id: "playful", label: "Playful", temperature: 1.3 },
  { id: "wild", label: "Wild", temperature: 1.6 },
];

export const DEFAULT_TEMPERAMENT_INDEX = 2;

/** The temperature for a slider stop (undefined for "Default"). */
export function temperatureForPresetIndex(index: number): number | undefined {
  return TEMPERAMENT_PRESETS[index]?.temperature;
}

/** The slider stop for a stored temperature: the nearest preset, or "Default" when unset. */
export function presetIndexForTemperature(temperature?: number): number {
  const value = normalizeTemperature(temperature);
  if (value === undefined) return DEFAULT_TEMPERAMENT_INDEX;
  let best = -1;
  TEMPERAMENT_PRESETS.forEach((preset, i) => {
    if (preset.temperature === undefined) return;
    if (
      best === -1 ||
      Math.abs(preset.temperature - value) <
        Math.abs((TEMPERAMENT_PRESETS[best].temperature ?? 0) - value)
    ) {
      best = i;
    }
  });
  return best;
}

/** A usable temperature, or undefined for anything else (so a hand-edited roster cannot break a turn). */
export function normalizeTemperature(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_TEMPERATURE &&
    value <= MAX_TEMPERATURE
    ? value
    : undefined;
}

interface ModelRef {
  name: string;
  provider: string;
  connection?: string;
}

// Models that must run at their own default temperature: the OpenAI GPT-5 and
// newer reasoning models (language_model_constants.ts: "Requires temperature to
// be default value (1)"), anything through a ChatGPT subscription, and Claude
// Code, which takes no temperature at all.
const FIXED_TEMPERATURE_MODEL_NAME = /(^|\/)(gpt-[5-9]|o[1-9](-|$))/i;

/** True when this model ignores or rejects a custom temperature. */
export function modelIgnoresTemperament(model: ModelRef): boolean {
  return (
    model.provider === "openai" ||
    model.provider === "claude-code" ||
    model.connection === "subscription" ||
    FIXED_TEMPERATURE_MODEL_NAME.test(model.name)
  );
}

/**
 * The temperature to send: the entity's own when it has one and the model can
 * take it, otherwise the model's default (which may be undefined).
 */
export function chooseTemperature(args: {
  modelDefault: number | undefined;
  entityTemperature: unknown;
  model: ModelRef;
}): number | undefined {
  const entity = normalizeTemperature(args.entityTemperature);
  if (entity === undefined || modelIgnoresTemperament(args.model)) {
    return args.modelDefault;
  }
  return entity;
}
