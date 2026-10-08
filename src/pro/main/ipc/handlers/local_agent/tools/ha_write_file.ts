import path from "node:path";
import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import {
  getHomeAssistantSettings,
  getHaConfigRoot,
  resolveHaPath,
  withHaSsh,
  runHaCommandWithSudoFallback,
  shQuote,
} from "./ha_client";

const SUDO_DENIED_MESSAGE =
  "Home Assistant denied the write, and sudo isn't allowed for this SSH user.";

const haWriteFileSchema = z.object({
  path: z
    .string()
    .describe(
      'File to write, relative to Home Assistant\'s config folder (e.g. "dashboards/kitchen-3.yaml", "www/mission-control.html"). Overwrites if it already exists; parent folders are created as needed.',
    ),
  content: z.string().describe("The full file contents to write."),
});

export const haWriteFileTool: ToolDefinition<
  z.infer<typeof haWriteFileSchema>
> = {
  name: "ha_write_file",
  description: `Write (create or overwrite) a file under Home Assistant's config directory -- dashboard YAML, files under www/, etc.

- Path is relative to HA's config root; a path escaping it is refused.
- Always writes the FULL file contents -- there is no partial-edit mode. Read the file first with ha_read_file if you need to change only part of it.
- This changes Tim's live Home Assistant, not the app project. It does not reload or restart anything on its own -- say so if a dashboard needs a manual "reload" in HA to pick up the change.
- This tool cannot control devices or call Home Assistant services -- it only writes files.`,
  inputSchema: haWriteFileSchema,
  defaultConsent: "ask",
  modifiesState: true,
  requiresBlueprintApproval: false,

  getConsentPreview: (args) =>
    `Write Home Assistant file ${args.path} (${args.content.length.toLocaleString()} chars)`,

  buildXml: (args, isComplete) => {
    if (!args.path?.trim()) return undefined;
    const content = args.content ?? "";
    return `<dyad-ha-write-file path="${escapeXmlAttr(args.path)}"${
      isComplete ? "" : ' streaming="true"'
    }>${escapeXmlContent(content)}</dyad-ha-write-file>`;
  },

  shouldTrackMutation: (_args, result) => result.startsWith("Wrote "),

  execute: async (args, _ctx: AgentContext) => {
    const ha = getHomeAssistantSettings();
    const root = getHaConfigRoot(ha);
    const target = resolveHaPath(root, args.path);
    const parentDir = path.posix.dirname(target);

    await withHaSsh(ha, async (session) => {
      await runHaCommandWithSudoFallback(
        session,
        `mkdir -p ${shQuote(parentDir)}`,
        `sudo -n mkdir -p ${shQuote(parentDir)}`,
        undefined,
        SUDO_DENIED_MESSAGE,
      );
      await runHaCommandWithSudoFallback(
        session,
        `cat > ${shQuote(target)}`,
        `sudo -n tee ${shQuote(target)} >/dev/null`,
        { input: args.content },
        SUDO_DENIED_MESSAGE,
      );
    });

    return `Wrote ${target} (${args.content.length.toLocaleString()} chars). If this changed a dashboard, it may need a manual reload in Home Assistant (Developer Tools > YAML, or the dashboard's own reload) to pick up the change.`;
  },
};
