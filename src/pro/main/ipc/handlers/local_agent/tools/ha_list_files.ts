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

const haListFilesSchema = z.object({
  path: z
    .string()
    .optional()
    .describe(
      'Directory to list, relative to Home Assistant\'s config folder. Omit or use "." for the config root (e.g. "www", "dashboards").',
    ),
});

export const haListFilesTool: ToolDefinition<
  z.infer<typeof haListFilesSchema>
> = {
  name: "ha_list_files",
  description: `List files and folders under Home Assistant's config directory (read-only) -- e.g. dashboards, the www/ folder, packages, etc.

- Path is relative to HA's config root; a path escaping it is refused.
- Does not touch entities or run any Home Assistant service -- this only browses the filesystem.`,
  inputSchema: haListFilesSchema,
  defaultConsent: "always",
  modifiesState: false,

  getConsentPreview: (args) => `List Home Assistant files at ${args.path?.trim() || "config root"}`,

  buildXml: (args, _isComplete) => {
    const attrs = args.path ? ` path="${escapeXmlAttr(args.path)}"` : "";
    return `<dyad-ha-list-files${attrs}></dyad-ha-list-files>`;
  },

  execute: async (args, _ctx: AgentContext) => {
    const ha = getHomeAssistantSettings();
    const root = getHaConfigRoot(ha);
    const target = resolveHaPath(root, args.path?.trim() || ".");

    return withHaSsh(ha, async (session) => {
      // -A hides . and .. but keeps dotfiles; -p marks directories with a
      // trailing slash so the model doesn't have to guess file vs folder.
      const output = await runHaCommand(
        session,
        `ls -Ap ${shQuote(target)}`,
      );
      const entries = output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (entries.length === 0) {
        return `${target} is empty.`;
      }
      return `${target}:\n${entries.join("\n")}`;
    });
  },
};