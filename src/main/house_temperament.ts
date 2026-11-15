import { readRoster } from "@/pro/main/ipc/handlers/local_agent/house";
import { normalizeTemperature } from "@/shared/temperament";
import { ModelSelectionSchema, type ModelSelection } from "@/lib/schemas";

/**
 * The temperament (temperature) of the entity speaking in this chat, or
 * undefined when it has none. The speaker is the entity picked for the chat,
 * else the entity whose room this is. Old rosters have no temperature, and a
 * roster that cannot be read changes nothing.
 */
export function entityTemperatureForChat(chat: {
  sisterId?: string | null;
  app: { id: number };
}): number | undefined {
  try {
    const roster = readRoster();
    const speaker =
      roster.find((s) => s.id === chat.sisterId) ??
      roster.find((s) => s.appId === chat.app.id);
    return normalizeTemperature(speaker?.temperature);
  } catch {
    return undefined;
  }
}

/** A usable roster model, or undefined for anything malformed (old or hand-edited rosters). */
export function normalizeEntityModel(
  value: unknown,
): ModelSelection | undefined {
  const parsed = ModelSelectionSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The model of the entity speaking in this chat (the entity picked for the chat,
 * else the entity whose room this is), or undefined when she has none.
 */
export function entityModelSelectionForChat(chat: {
  sisterId?: string | null;
  app: { id: number };
}): ModelSelection | undefined {
  try {
    const roster = readRoster();
    const speaker =
      roster.find((s) => s.id === chat.sisterId) ??
      roster.find((s) => s.appId === chat.app.id);
    return normalizeEntityModel(speaker?.modelSelection);
  } catch {
    return undefined;
  }
}

/** The model of the entity whose room is this app, for chats created in it. */
export function entityModelSelectionForApp(
  appId: number,
): ModelSelection | undefined {
  try {
    return normalizeEntityModel(
      readRoster().find((s) => s.appId === appId)?.modelSelection,
    );
  } catch {
    return undefined;
  }
}

/** The image engine this entity starts with for base-picture edits, or undefined. */
export function entityImageEngine(
  sisterId: string | null | undefined,
  appId: number,
): string | undefined {
  try {
    const roster = readRoster();
    const speaker =
      roster.find((s) => s.id === sisterId) ??
      roster.find((s) => s.appId === appId);
    const name = speaker?.imageEngine;
    return typeof name === "string" && name.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}
