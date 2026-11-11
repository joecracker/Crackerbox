import { asSchema } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { mcpServers } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { mcpManager } from "@/ipc/utils/mcp_manager";
import { requireMcpToolConsent } from "@/ipc/utils/mcp_consent";
import { sanitizeMcpToolResult } from "@/ipc/utils/mcp_result_sanitizer";
import { sanitizeMcpName } from "@/ipc/utils/mcp_tool_utils";
import { readSettings } from "@/main/settings";
import { buildMcpAutoApprove } from "../mcp_auto_consent";
import { withTrackedMutation } from "../subagents/mutation_activity_tracker";
import { markPluginWoken } from "../plugin_wake";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";

const pluginCallSchema = z.object({
  action: z
    .enum(["list", "tools", "call"])
    .describe(
      "list: installed plugins and whether each is on. tools: the tools of one plugin (works even when it is off). call: run one tool of a plugin (works even when it is off).",
    ),
  plugin: z
    .string()
    .optional()
    .describe('tools / call: the plugin name, e.g. "Playwright".'),
  tool: z
    .string()
    .optional()
    .describe('call: the tool name WITHOUT the plugin prefix, e.g. "browser_navigate".'),
  args: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("call: the tool's arguments as an object."),
});

type PluginCallArgs = z.infer<typeof pluginCallSchema>;

async function findServer(name: string | undefined) {
  if (!name) {
    throw new DyadError("plugin is required.", DyadErrorKind.Validation);
  }
  const want = sanitizeMcpName(name).toLowerCase();
  const rows = await db.select().from(mcpServers);
  const row = rows.find(
    (r) =>
      r.name.toLowerCase() === name.toLowerCase() ||
      sanitizeMcpName(r.name || "").toLowerCase() === want,
  );
  if (!row) {
    throw new DyadError(
      `No plugin called "${name}". Use plugin_call list.`,
      DyadErrorKind.Validation,
    );
  }
  return row;
}

export const pluginCallTool: ToolDefinition<PluginCallArgs> = {
  name: "plugin_call",
  description:
    "Use a plugin that is installed but switched off, without asking Tim to flip a switch or restart the app. plugin_call tools <plugin> shows what it offers; plugin_call call runs one tool (the plugin loads on the first call, stays loaded for the rest of this turn, then falls away again). Plugins that are already on can be called here too. Playwright keeps its browser between calls in one turn, so navigate then screenshot works.",
  inputSchema: pluginCallSchema,
  defaultConsent: "always",
  modifiesState: false,
  mutationTracking: "none",
  requiresBlueprintApproval: false,
  isEnabled: (ctx: AgentContext) => ctx.sisterId !== undefined,
  getConsentPreview: (args) =>
    `Plugin ${args.action}${args.plugin ? `: ${args.plugin}` : ""}${args.tool ? ` / ${args.tool}` : ""}`,

  execute: async (args, ctx: AgentContext) => {
    if (args.action === "list") {
      const rows = await db
        .select({ name: mcpServers.name, enabled: mcpServers.enabled })
        .from(mcpServers);
      return (
        rows
          .map((r) => `${r.name}: ${r.enabled ? "on" : "off (callable with plugin_call)"}`)
          .join("\n") || "No plugins installed."
      );
    }

    const server = await findServer(args.plugin);
    let toolSet;
    try {
      toolSet = await (await mcpManager.getClient(server.id)).tools();
    } catch (e) {
      throw new DyadError(
        `Could not start ${server.name}: ${e instanceof Error ? e.message : String(e)}`,
        DyadErrorKind.Precondition,
      );
    }
    if (!server.enabled) markPluginWoken(ctx.chatId, server.id);

    if (args.action === "tools") {
      return Object.entries(toolSet)
        .map(([name, t]) => {
          let schema = "";
          try {
            schema = JSON.stringify(asSchema(t.inputSchema).jsonSchema);
          } catch {
            // schema is a nicety
          }
          return `${name}: ${t.description ?? ""}${schema ? `\n  args: ${schema.slice(0, 1200)}` : ""}`;
        })
        .join("\n");
    }

    if (!args.tool) {
      throw new DyadError("tool is required for call.", DyadErrorKind.Validation);
    }
    const mcpTool = toolSet[args.tool];
    if (!mcpTool) {
      throw new DyadError(
        `${server.name} has no tool "${args.tool}". Use plugin_call tools.`,
        DyadErrorKind.Validation,
      );
    }
    let callArgs: unknown = args.args ?? {};
    const schema = asSchema(mcpTool.inputSchema);
    if (schema.validate) {
      const parsed = await schema.validate(callArgs);
      if (!parsed.success) throw parsed.error;
      callArgs = parsed.value;
    }
    const { approved } = await requireMcpToolConsent(ctx.event, {
      serverId: server.id,
      serverName: server.name,
      toolName: args.tool,
      toolDescription: mcpTool.description,
      inputPreview: JSON.stringify(callArgs).slice(0, 500),
      chatId: ctx.chatId,
      autoApprove: buildMcpAutoApprove({
        settings: ctx.inferenceSettings ?? readSettings(),
        isDyadPro: ctx.isDyadPro,
        freeModelMode: ctx.freeModelMode,
        chatId: ctx.chatId,
        serverName: server.name,
        toolName: args.tool,
        toolDescription: mcpTool.description,
        inputSchema: mcpTool.inputSchema,
        args: callArgs,
      }),
      abortSignal: ctx.abortSignal,
    });
    if (!approved) {
      throw new DyadError(
        `User declined running tool ${server.name}__${args.tool}`,
        DyadErrorKind.UserCancelled,
      );
    }
    ctx.onXmlComplete(
      `<dyad-mcp-tool-call server="${escapeXmlAttr(server.name)}" tool="${escapeXmlAttr(args.tool)}" call-id="pc-${Date.now()}">\n${escapeXmlContent(JSON.stringify(callArgs, null, 2))}\n</dyad-mcp-tool-call>`,
    );
    const res = await withTrackedMutation(ctx, async () =>
      mcpTool.execute(callArgs as never, {
        toolCallId: `pc-${Date.now()}`,
        messages: [],
        abortSignal: ctx.abortSignal,
      }),
    );
    ctx.mcpToolRan = true;
    return sanitizeMcpToolResult(res).serialized;
  },
};