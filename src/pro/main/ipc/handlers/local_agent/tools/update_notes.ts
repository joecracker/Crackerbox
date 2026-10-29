import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  MAX_AGENT_NOTES_CHARS,
  readAgentNotes,
  writeAgentNotes,
} from "../agent_notes";

const updateNotesSchema = z.object({
  notes: z
    .string()
    .describe(
      "The complete new text of your notes for this app. It replaces the old notes, so keep everything still worth keeping. Empty text clears them.",
    ),
});

export const updateNotesTool: ToolDefinition<
  z.infer<typeof updateNotesSchema>
> = {
  name: "update_notes",
  description: `Keep your own working notes about this app and the environment around it. They are shown to you at the start of every future chat in this app.

Use it at the end of a job in which you learned something that would have saved you steps: where things live (folders, logs, config), how something is started or restarted, what a name or setting really does, what worked, and dead ends not worth trying again. Fix or delete lines that turned out wrong. Short plain bullets, facts only, no stories. Maximum ${MAX_AGENT_NOTES_CHARS} characters. This replaces the whole notes text, so include what you are keeping.`,
  inputSchema: updateNotesSchema,
  defaultConsent: "always",
  modifiesState: false,
  mutationTracking: "none",
  requiresBlueprintApproval: false,

  getConsentPreview: () => "Update my notes for this app",

  execute: async (args, ctx: AgentContext) => {
    if (args.notes.length > MAX_AGENT_NOTES_CHARS) {
      throw new DyadError(
        `Notes are ${args.notes.length} characters; the limit is ${MAX_AGENT_NOTES_CHARS}. Condense them (merge lines, drop stale ones) and try again.`,
        DyadErrorKind.Validation,
      );
    }
    const before = readAgentNotes(ctx.appId);
    writeAgentNotes(ctx.appId, args.notes);
    return args.notes.trim()
      ? `Notes saved (${args.notes.trim().length} characters${before ? ", replacing the old notes" : ""}).`
      : "Notes cleared.";
  },
};
