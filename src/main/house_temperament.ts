import { readRoster } from "@/pro/main/ipc/handlers/local_agent/house";
import { normalizeTemperature } from "@/shared/temperament";

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
