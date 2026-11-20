import { z } from "zod";
import log from "electron-log";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mcpServers } from "@/db/schema";
import { readSettings, tryWriteSettings } from "@/main/settings";
import { userInputRegistry } from "@/user_input/main";
import {
  ToolDefinition,
  AgentContext,
  ToolDescriptionContext,
  escapeXmlAttr,
} from "./types";

const logger = log.scope("suggest_plugin");

/** One of the user's own switched-off plugins the agent may offer to turn on mid-task. */
export interface SuggestablePlugin {
  slug: string;
  name: string;
  description?: string;
  /** The plugin's row id. Its slug is `custom-<id>`; connecting it only switches that row on. */
  localServerId: number;
}

const LOCAL_SLUG_PREFIX = "custom-";

export function localServerIdFromSlug(slug: string): number | null {
  if (!slug.startsWith(LOCAL_SLUG_PREFIX)) return null;
  const id = Number(slug.slice(LOCAL_SLUG_PREFIX.length));
  return Number.isInteger(id) ? id : null;
}

// One-line hints for the user's own plugins so the model can tell what each
// is for without loading any of its tools.
const LOCAL_PLUGIN_HINTS: Record<string, string> = {
  github:
    "Read, search and change the user's GitHub repos, issues and pull requests (large tool set)",
  playwright:
    "Drive a real Chrome browser: open pages, click, read, take screenshots",
  context7: "Look up current library and framework documentation",
  "sequential-thinking":
    "Step-by-step planning scratchpad for hard multi-step problems",
  "ship-check":
    "Check a live site for errors and scan a folder for leaked keys before pushing",
};

/** The user's own plugins that are installed but switched off. */
async function collectOwnDisabledPlugins(
  chatId: number,
): Promise<SuggestablePlugin[]> {
  const rows = await db
    .select({
      id: mcpServers.id,
      name: mcpServers.name,
      enabled: mcpServers.enabled,
      catalogSlug: mcpServers.catalogSlug,
    })
    .from(mcpServers);
  const declined = declinedSlugsByChat.get(chatId);
  const neverSuggest = new Set(readSettings().neverSuggestPluginSlugs ?? []);
  return rows
    .filter((row) => !row.enabled && !row.catalogSlug)
    .map((row) => ({
      slug: `${LOCAL_SLUG_PREFIX}${row.id}`,
      name: row.name,
      description: LOCAL_PLUGIN_HINTS[row.name.toLowerCase()],
      localServerId: row.id,
    }))
    .filter(
      (plugin) => !declined?.has(plugin.slug) && !neverSuggest.has(plugin.slug),
    );
}

// Suggestions the user declined, per chat, so the plugin is not offered
// again in that conversation. In-memory: a restart clears it, which is
// acceptable for a preference this small.
const declinedSlugsByChat = new Map<number, Set<string>>();
// Chats with a suggestion currently parked. The agent can issue parallel
// tool calls, and the chat card can show only one live suggestion.
const chatsWithLiveSuggestion = new Set<number>();
// Slugs already offered in a turn, keyed by chat and assistant message, so
// a suggestion that timed out or was dismissed is not parked a second time
// in the same turn.
const attemptedSlugsByTurn = new Map<string, Set<string>>();

export function resetSuggestPluginStateForTests() {
  declinedSlugsByChat.clear();
  chatsWithLiveSuggestion.clear();
  attemptedSlugsByTurn.clear();
}

function addTo(
  map: Map<number | string, Set<string>>,
  key: number | string,
  slug: string,
) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(slug);
}

async function isPluginUsable(slug: string): Promise<boolean> {
  const localId = localServerIdFromSlug(slug);
  if (localId === null) return false;
  const local = await db
    .select({ enabled: mcpServers.enabled })
    .from(mcpServers)
    .where(eq(mcpServers.id, localId));
  return !!local[0]?.enabled;
}

/**
 * The user's own plugins that are installed but switched off, minus the ones
 * the user declined in this chat or asked never to be offered again.
 */
export async function collectSuggestablePlugins({
  chatId,
}: {
  chatId: number;
}): Promise<SuggestablePlugin[]> {
  return collectOwnDisabledPlugins(chatId);
}

const suggestPluginSchema = z.object({
  slug: z
    .string()
    .min(1)
    .describe(
      "Slug of the plugin to suggest. Must be one of the slugs listed in this tool's description.",
    ),
  reason: z
    .string()
    .min(1)
    .max(300)
    .describe(
      "One sentence, addressed to the user, stating the step you are about to take that needs this plugin. Shown on the suggestion card and used to resume the task once the plugin is connected.",
    ),
});

type SuggestPluginArgs = z.infer<typeof suggestPluginSchema>;

const BASE_DESCRIPTION = `Ask the user to switch on one of their own plugins (an MCP server they installed but that is currently off) so you can use its tools. Their tools are not loaded while a plugin is off, so when your next step needs one, call this tool and the user switches it on with one tap. Do not try to work around a listed plugin.

Call this only at the moment your next step needs a capability that one of the plugins below provides and no available tool can do it, for example driving a real browser or reading a platform's logs. Never call it speculatively, and never suggest the same plugin twice in a conversation.

The tool blocks until the user connects the plugin or declines. When the user connects it, the plugin's tools are NOT available in this turn: Crackerbox queues a follow-up turn where they will be. In that case end your response with one short line saying you will continue once the plugin is ready, and do not attempt the step another way. If the user declines, continue without the plugin.`;

function formatAvailablePlugins(servers: SuggestablePlugin[]): string {
  const lines = servers.map((server) => {
    const description = server.description?.trim();
    return description
      ? `- ${server.slug}: ${server.name} — ${description}`
      : `- ${server.slug}: ${server.name}`;
  });
  return `Plugins available to suggest (slug: name — what it does):\n${lines.join("\n")}`;
}

function pendingXml(
  server: { slug: string; name: string },
  reason: string,
  requestId: string,
): string {
  return `<dyad-suggest-plugin slug="${escapeXmlAttr(server.slug)}" name="${escapeXmlAttr(server.name)}" reason="${escapeXmlAttr(reason)}" request-id="${escapeXmlAttr(requestId)}" outcome="pending"></dyad-suggest-plugin>`;
}

function terminalXml(
  server: { slug: string; name: string },
  reason: string,
  outcome: "connected" | "declined" | "never" | "dismissed",
): string {
  return `<dyad-suggest-plugin slug="${escapeXmlAttr(server.slug)}" name="${escapeXmlAttr(server.name)}" reason="${escapeXmlAttr(reason)}" outcome="${outcome}"></dyad-suggest-plugin>`;
}

export const suggestPluginTool: ToolDefinition<SuggestPluginArgs> = {
  name: "suggest_plugin",
  description: BASE_DESCRIPTION,
  getDescription: (ctx: ToolDescriptionContext) => {
    const servers = ctx.suggestablePlugins ?? [];
    if (servers.length === 0) return BASE_DESCRIPTION;
    return `${BASE_DESCRIPTION}\n\n${formatAvailablePlugins(servers)}`;
  },
  inputSchema: suggestPluginSchema,
  defaultConsent: "always",
  // Adding a plugin changes main-process state, so the tool stays out of
  // Ask and Plan; it never touches the workspace, so finalization has
  // nothing to track and blueprint approval does not gate it.
  modifiesState: true,
  mutationTracking: "none",
  requiresBlueprintApproval: false,
  isEnabled: (ctx) => (ctx.suggestablePlugins?.length ?? 0) > 0,

  getConsentPreview: (args) => `Suggest connecting the ${args.slug} plugin`,

  execute: async (args, ctx: AgentContext) => {
    const servers = ctx.suggestablePlugins ?? [];
    const server = servers.find((candidate) => candidate.slug === args.slug);
    // Nothing is requested on these paths, so a dismissed card records the
    // attempt in the transcript without rendering anything.
    if (!server) {
      ctx.onXmlComplete(
        terminalXml(
          { slug: args.slug, name: args.slug },
          args.reason,
          "dismissed",
        ),
      );
      const available = servers.map((candidate) => candidate.slug).join(", ");
      return available
        ? `"${args.slug}" is not a plugin you can suggest. Available slugs: ${available}. Either pick one of those or continue without a plugin.`
        : `"${args.slug}" is not a plugin you can suggest, and no plugins are available to suggest right now. Continue without one.`;
    }
    if (chatsWithLiveSuggestion.has(ctx.chatId)) {
      ctx.onXmlComplete(terminalXml(server, args.reason, "dismissed"));
      return `Another plugin suggestion is already waiting for the user in this chat. Wait for its result before suggesting ${server.name}.`;
    }
    // Claim the chat before any await so a parallel call cannot slip past
    // the check above.
    chatsWithLiveSuggestion.add(ctx.chatId);
    try {
      // The turn's suggestable set is fixed at turn start, so re-check what
      // has settled since: a decline in this chat, an earlier attempt this
      // turn, or a plugin that became usable.
      if (declinedSlugsByChat.get(ctx.chatId)?.has(server.slug)) {
        ctx.onXmlComplete(terminalXml(server, args.reason, "dismissed"));
        return `The user already declined the ${server.name} plugin in this conversation. Continue without it and do not suggest it again.`;
      }
      const turnKey = `${ctx.chatId}:${ctx.messageId}`;
      if (attemptedSlugsByTurn.get(turnKey)?.has(server.slug)) {
        ctx.onXmlComplete(terminalXml(server, args.reason, "dismissed"));
        return `You already suggested the ${server.name} plugin in this turn and the user did not connect it. Continue without it.`;
      }
      if (await isPluginUsable(server.slug)) {
        ctx.onXmlComplete(terminalXml(server, args.reason, "dismissed"));
        return `The ${server.name} plugin is already connected. Its tools become available the next time the user sends a message, not in this turn. Tell the user that and continue with whatever you can do without it.`;
      }

      const followUpPrompt = `Continue. I have connected the ${server.name} plugin. Resume what you needed it for: ${args.reason}`;
      const requestId = userInputRegistry.request({
        kind: "plugin-suggestion",
        chatId: ctx.chatId,
        slug: server.slug,
        serverName: server.name,
        serverDescription: server.description ?? null,
        needsOAuth: false,
        reason: args.reason,
        classifier: "none",
        followUpPrompt,
      });
      addTo(attemptedSlugsByTurn, turnKey, server.slug);
      // Persist the interactive card, carrying the request id, before the
      // park: reloads and cross-window tab transfers rebuild it from the
      // message, and the id is what makes only this card live.
      ctx.onXmlComplete(pendingXml(server, args.reason, requestId));
      logger.log(
        `Presenting plugin suggestion (slug: ${server.slug}), requestId: ${requestId}`,
      );

      const result = await userInputRegistry.park(requestId, ctx.abortSignal);

      if (result?.kind !== "plugin-suggestion") {
        ctx.onXmlComplete(terminalXml(server, args.reason, "dismissed"));
        return `The user did not respond to the ${server.name} plugin suggestion. Continue without it, and ask them how they'd like to proceed if the step cannot be completed another way.`;
      }
      if (result.outcome === "declined") {
        addTo(declinedSlugsByChat, ctx.chatId, server.slug);
        ctx.onXmlComplete(terminalXml(server, args.reason, "declined"));
        return `The user declined to connect the ${server.name} plugin. Continue the task without it and do not suggest it again in this conversation.`;
      }
      if (result.outcome === "never") {
        // Persisted per plugin, so it holds across chats and restarts.
        // Best-effort: the user has answered, so a settings problem must
        // not abort the tool before the card and the model hear about it.
        // The per-chat decline below still covers this conversation.
        const existing = readSettings().neverSuggestPluginSlugs ?? [];
        if (!existing.includes(server.slug)) {
          tryWriteSettings(
            { neverSuggestPluginSlugs: [...existing, server.slug] },
            "storing a plugin's never-suggest choice",
          );
        }
        addTo(declinedSlugsByChat, ctx.chatId, server.slug);
        ctx.onXmlComplete(terminalXml(server, args.reason, "never"));
        return `The user asked never to be offered the ${server.name} plugin again. Continue the task without it and never suggest it again.`;
      }
      ctx.onXmlComplete(terminalXml(server, args.reason, "connected"));
      return `The user connected the ${server.name} plugin. Its tools are not available in this turn; Crackerbox has queued a follow-up turn where they will be. End your response now with one short line saying you will continue once the plugin is ready, and do not attempt the step another way.`;
    } finally {
      chatsWithLiveSuggestion.delete(ctx.chatId);
    }
  },
};
