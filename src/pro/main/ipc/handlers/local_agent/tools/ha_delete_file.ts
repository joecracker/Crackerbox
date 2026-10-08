import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlAttr } from "./types";
import {
  getHomeAssistantSettings,
  getHaConfigRoot,
  resolveHaPath,
  withHaSsh,
  runHaCommandWithSudoFallback,
  shQuote,
} from "./ha_client";

const SUDO_DENIED_MESSAGE =
  "Home Assistant denied the delete, and sudo isn't allowed for this SSH user.";

const haDeleteFileSchema = z.object({
  path: z
    .string()
    .refine((value) => value.trim().length > 0, {
      message: "Path cannot be empty",
    })
    .describe(
      "File or folder to delete, relative to Home Assistant's config folder. A folder is removed recursively.",
    ),
});

export const haDeleteFileTool: ToolDefinition<
  z.infer<typeof haDeleteFileSchema>
> = {
  name: "ha_delete_file",
  description: `Delete a file or folder under Home Assistant's config directory -- e.g. an old dashboard file.

- Path is relative to HA's config root; a path escaping it is refused, and the root itself can never be targeted.
- This changes Tim's live Home Assistant, not the app project, and cannot be undone from here.`,
  inputSchema: haDeleteFileSchema,
  defaultConsent: "ask",
  modifiesState: true,
  requiresBlueprintApproval: false,

  getConsentPreview: (args) => `Delete Home Assistant file ${args.path}`,

  buildXml: (args, _isComplete) => {
    if (!args.path?.trim()) return undefined;
    return `<dyad-ha-delete-file path="${escapeXmlAttr(args.path)}"></dyad-ha-delete-file>`;
  },

  shouldTrackMutation: (_args, result) => result.startsWith("Deleted "),

  execute: async (args, _ctx: AgentContext) => {
    const ha = getHomeAssistantSettings();
    const root = getHaConfigRoot(ha);
    const target = resolveHaPath(root, args.path);

    if (target === root) {
      return "Refused: that path is Home Assistant's config root, not a file or folder inside it.";
    }

    await withHaSsh(ha, (session) =>
      runHaCommandWithSudoFallback(
        session,
        `rm -rf ${shQuote(target)}`,
        `sudo -n rm -rf ${shQuote(target)}`,
        undefined,
        SUDO_DENIED_MESSAGE,
      ),
    );

    return `Deleted ${target}.`;
  },
};
