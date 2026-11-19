import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chats } from "@/db/schema";
import {
  readRoster,
  writeRoster,
  type Sister,
} from "@/pro/main/ipc/handlers/local_agent/house";

// Per-entity approvals for helpers that ask before every step. The global
// per-tool settings are shared by every entity, so a helper keeps its own list:
// a tool is allowed without asking only when Tim said "Always allow" to it for
// THIS helper. Everything else is asked, whatever the tool's default is.

type ConsentFields = Pick<Sister, "askEveryStep" | "toolConsents">;

/** "ask" or "always" for a helper that asks every step; undefined for any other entity. */
export function entityConsentFor(
  sister: ConsentFields | undefined,
  toolName: string,
): "ask" | "always" | undefined {
  if (!sister?.askEveryStep) return undefined;
  return sister.toolConsents?.[toolName] === "always" ? "always" : "ask";
}

/** The ask-every-step helper whose room this chat is in, if any. */
export async function strictEntityForChat(
  chatId: number,
): Promise<Sister | undefined> {
  try {
    const [chat] = await db
      .select({ appId: chats.appId, sisterId: chats.sisterId })
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1);
    if (!chat) return undefined;
    // The speaker picked for the chat counts as much as the room it is in.
    return readRoster().find(
      (s) =>
        s.askEveryStep && (s.id === chat.sisterId || s.appId === chat.appId),
    );
  } catch {
    return undefined;
  }
}

export function rememberEntityAlways(id: string, toolName: string): void {
  const roster = readRoster();
  const sister = roster.find((s) => s.id === id);
  if (!sister?.askEveryStep) return;
  sister.toolConsents = { ...sister.toolConsents, [toolName]: "always" };
  writeRoster(roster);
}

export function forgetEntityAlways(id: string, toolName: string): void {
  const roster = readRoster();
  const sister = roster.find((s) => s.id === id);
  if (!sister?.toolConsents || !(toolName in sister.toolConsents)) return;
  const { [toolName]: _gone, ...rest } = sister.toolConsents;
  if (Object.keys(rest).length === 0) delete sister.toolConsents;
  else sister.toolConsents = rest;
  writeRoster(roster);
}

export function listEntityAlways(id: string): string[] {
  const sister = readRoster().find((s) => s.id === id);
  return Object.keys(sister?.toolConsents ?? {}).sort();
}
