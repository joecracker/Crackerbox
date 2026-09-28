import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import {
  getHomeAssistantSettings,
  getHaConfigRoot,
  resolveHaPath,
  withHaSsh,
  runHaCommand,
  shQuote,
} from "./ha_client";

const MAX_READ_CHARS = 60_000;

const haReadFileSchema = z.object({
  path: z
    .string()
    .describe(
      "File to read, relative to Home Assistant's config folder (e.g. \"dashboards/kitchen-3.yaml\", \"www/mission-control.html\").",
    ),
});

export const haReadFileTool: ToolDefinition<z.infer<typeof haReadFileSchema>> =
  {
    name: "ha_read_file",
    description: `Read a file's contents from Home Assistant's config directory (read-only) -- dashboard YAML, files under www/, etc.

- Path is relative to HA's config root; a path escaping it is refused.
- Large files are truncated with a notice; ask for a narrower path if you need the rest.`,
    inputSchema: haReadFileSchema,
    defaultConsent: "always",
    modifiesState: false,

    getConsentPreview: (args) => `Read Home Assistant file ${args.path}`,

    buildXml: (args, _isComplete) => {
      if (!args.path?.trim()) return undefined;
      return `<dyad-ha-read-file path="${escapeXmlAttr(args.path)}"></dyad-ha-read-file>`;
    },

    execute: async (args, _ctx: AgentContext) => {
      const ha = getHomeAssistantSettings();
      const root = getHaConfigRoot(ha);
      const target = resolveHaPath(root, args.path);

      return withHaSsh(ha, async (session) => {
        const content = await runHaCommand(session, `cat ${shQuote(target)}`);
        if (content.length > MAX_READ_CHARS) {
          return (
            content.slice(0, MAX_READ_CHARS) +
            `\n\n[Truncated: file is ${content.length} characters; showing the first ${MAX_READ_CHARS}.]`
          );
        }
        return content;
      });
    },
  };