import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import { getHomeAssistantSettings, haRestFetch } from "./ha_client";

const MAX_RESULTS = 300;

const haListEntitiesSchema = z.object({
  domain: z
    .string()
    .optional()
    .describe(
      'Optional. Only return entities in this domain (the part before the dot in an entity_id), e.g. "light", "sensor", "switch", "binary_sensor", "media_player".',
    ),
  search: z
    .string()
    .optional()
    .describe(
      "Optional. Only return entities whose entity_id or friendly name contains this text (case-insensitive).",
    ),
});

interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export const haListEntitiesTool: ToolDefinition<
  z.infer<typeof haListEntitiesSchema>
> = {
  name: "ha_list_entities",
  description: `List Home Assistant entities (read-only) so they can be wired up into dashboard cards.

- Returns entity_id, current state, and friendly name for each match.
- Filter with \`domain\` (e.g. "light", "sensor") and/or \`search\` to keep the list manageable -- a Home Assistant instance can have hundreds of entities.
- This tool cannot control anything (no service calls); it only reads current state.`,
  inputSchema: haListEntitiesSchema,
  defaultConsent: "always",
  modifiesState: false,

  getConsentPreview: (args) => {
    const parts = [
      args.domain ? `domain: ${args.domain}` : null,
      args.search ? `search: "${args.search}"` : null,
    ].filter(Boolean);
    return parts.length
      ? `List Home Assistant entities (${parts.join(", ")})`
      : "List Home Assistant entities";
  },

  buildXml: (args, _isComplete) => {
    const attrs: string[] = [];
    if (args.domain) attrs.push(`domain="${escapeXmlAttr(args.domain)}"`);
    if (args.search) attrs.push(`search="${escapeXmlAttr(args.search)}"`);
    return `<dyad-ha-list-entities${attrs.length ? " " + attrs.join(" ") : ""}></dyad-ha-list-entities>`;
  },

  execute: async (args, _ctx: AgentContext) => {
    const ha = getHomeAssistantSettings();
    const res = await haRestFetch(ha, "/api/states");
    const states = (await res.json()) as HaState[];

    const domainFilter = args.domain?.trim().toLowerCase();
    const searchFilter = args.search?.trim().toLowerCase();

    const filtered = states.filter((s) => {
      if (domainFilter && !s.entity_id.startsWith(`${domainFilter}.`)) {
        return false;
      }
      if (searchFilter) {
        const friendlyName = String(s.attributes.friendly_name ?? "").toLowerCase();
        if (
          !s.entity_id.toLowerCase().includes(searchFilter) &&
          !friendlyName.includes(searchFilter)
        ) {
          return false;
        }
      }
      return true;
    });

    if (filtered.length === 0) {
      return "No matching entities found.";
    }

    const truncated = filtered.length > MAX_RESULTS;
    const shown = filtered.slice(0, MAX_RESULTS);
    const lines = shown.map((s) => {
      const friendlyName = s.attributes.friendly_name;
      const name = friendlyName ? ` (${friendlyName})` : "";
      return `${s.entity_id}${name} = ${s.state}`;
    });

    const header = `${filtered.length} entit${filtered.length === 1 ? "y" : "ies"}${
      truncated ? `, showing first ${MAX_RESULTS}` : ""
    }:`;
    return [header, ...lines].join("\n");
  },
};