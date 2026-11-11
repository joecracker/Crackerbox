import { eq } from "drizzle-orm";
import log from "electron-log";
import { db } from "@/db";
import { mcpServers } from "@/db/schema";
import { mcpManager } from "@/ipc/utils/mcp_manager";

const logger = log.scope("plugin_wake");

// Plugins that are switched OFF but were loaded for this turn by plugin_call,
// per chat. They are closed again when the turn ends.
const woken = new Map<number, Set<number>>();

export function markPluginWoken(chatId: number, serverId: number): void {
  let set = woken.get(chatId);
  if (!set) woken.set(chatId, (set = new Set()));
  set.add(serverId);
}

export async function closeWokenPlugins(chatId: number): Promise<void> {
  const ids = woken.get(chatId);
  woken.delete(chatId);
  if (!ids) return;
  for (const id of ids) {
    try {
      const rows = await db
        .select({ enabled: mcpServers.enabled })
        .from(mcpServers)
        .where(eq(mcpServers.id, id));
      if (rows[0]?.enabled) continue; // Tim switched it on meanwhile: leave it
      await mcpManager.dispose(id);
    } catch (e) {
      logger.warn(`Could not close woken plugin ${id}`, e);
    }
  }
}