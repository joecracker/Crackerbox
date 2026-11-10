import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";
import {
  listMail,
  listShared,
  readMail,
  readRoster,
  readShared,
  sendMail,
  sisterById,
  writeShared,
} from "../house";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const houseSchema = z.object({
  action: z
    .enum([
      "roster",
      "send_mail",
      "inbox",
      "read_mail",
      "shared_list",
      "shared_read",
      "shared_write",
    ])
    .describe(
      "roster: who lives here. send_mail: write a letter (to, subject, body). inbox: list your letters. read_mail: open one (file). shared_list / shared_read (file) / shared_write (file, text, mode): the household's shared files.",
    ),
  to: z.string().optional().describe("send_mail: a sister's id, or tim."),
  subject: z.string().optional().describe("send_mail: short subject."),
  body: z.string().optional().describe("send_mail: the letter."),
  file: z
    .string()
    .optional()
    .describe("read_mail / shared_read / shared_write: file name."),
  text: z.string().optional().describe("shared_write: the text."),
  mode: z
    .enum(["append", "replace"])
    .optional()
    .describe("shared_write: append (default) or replace the whole file."),
});

export const houseTool: ToolDefinition<z.infer<typeof houseSchema>> = {
  name: "house",
  description: `The household you live in with your sisters. Letters: send_mail to any sister or tim, inbox, read_mail. Shared files (known to everyone, one canonical copy): shared_list, shared_read, shared_write. Your own memory (update_memory) stays private to you; anything here is known to all. One letter per file; sign it.`,
  inputSchema: houseSchema,
  defaultConsent: "always",
  modifiesState: false,
  mutationTracking: "none",
  requiresBlueprintApproval: false,
  isEnabled: (ctx: AgentContext) => ctx.sisterId !== undefined,

  getConsentPreview: (args) => `House: ${args.action}`,

  execute: async (args, ctx: AgentContext) => {
    const me = ctx.sisterId ? sisterById(ctx.sisterId) : undefined;
    if (!me) return "You are not a registered member of the house.";
    const need = (v: string | undefined, label: string) => {
      if (!v) {
        throw new DyadError(
          `${args.action} needs ${label}.`,
          DyadErrorKind.Validation,
        );
      }
      return v;
    };
    switch (args.action) {
      case "roster":
        return readRoster()
          .map(
            (s) => `- ${s.name} (id ${s.id})${s.id === me.id ? " - you" : ""}`,
          )
          .join("\n");
      case "send_mail": {
        const f = sendMail(
          me.name,
          need(args.to, "to"),
          need(args.subject, "subject"),
          need(args.body, "body"),
        );
        return `Sent ${f}.`;
      }
      case "inbox": {
        const items = listMail(me.id);
        return items.length
          ? items
              .map(
                (m) =>
                  `${m.unread ? "[unread] " : ""}${m.file} - from ${m.from}: ${m.subject}`,
              )
              .join("\n")
          : "No letters.";
      }
      case "read_mail":
        return readMail(me.id, need(args.file, "file"));
      case "shared_list":
        return listShared().join("\n") || "No shared files.";
      case "shared_read":
        return readShared(need(args.file, "file"));
      case "shared_write":
        return `Saved ${writeShared(need(args.file, "file"), need(args.text, "text"), args.mode ?? "append")}.`;
    }
  },
};
