import { z } from "zod";
import { getGmailStatus, sendGmailMessage } from "@/ipc/services/gmail_service";
import type { ToolDefinition } from "./types";

const emailAddress = z.string().email();
const sendEmailSchema = z.object({
  to: z
    .array(emailAddress)
    .min(1)
    .describe("Primary recipient email addresses"),
  cc: z.array(emailAddress).optional().describe("Optional CC recipients"),
  bcc: z.array(emailAddress).optional().describe("Optional BCC recipients"),
  subject: z.string().min(1).describe("Email subject"),
  body: z.string().min(1).describe("Plain-text email body"),
  attachments: z
    .array(
      z.object({
        path: z.string().min(1).describe("Absolute path to the local file"),
        filename: z
          .string()
          .min(1)
          .optional()
          .describe("Optional filename shown to the recipient"),
      }),
    )
    .optional()
    .describe("Local files to attach, including generated PDFs and images"),
});

export const sendEmailTool: ToolDefinition<z.infer<typeof sendEmailSchema>> = {
  name: "send_email",
  description:
    "Send an email, optionally with local file attachments, from the Gmail account connected in Crackerbox Settings. Use only when the user explicitly asks to send an email. The user sees and approves the recipients, subject, message, and attachment list before it is sent.",
  inputSchema: sendEmailSchema,
  defaultConsent: "ask",
  modifiesState: true,
  mutationTracking: "none",
  requiresBlueprintApproval: false,
  isEnabled: () => getGmailStatus().connected,
  getConsentPreview: (args) =>
    `Send email\nTo: ${args.to.join(", ")}\n${args.cc?.length ? `CC: ${args.cc.join(", ")}\n` : ""}Subject: ${args.subject}\n${args.attachments?.length ? `Attachments:\n${args.attachments.map((file) => `- ${file.filename ?? file.path}`).join("\n")}\n` : ""}\n${args.body}`,
  execute: async (args) => {
    const id = await sendGmailMessage(args);
    return `Email sent to ${args.to.join(", ")}${args.attachments?.length ? ` with ${args.attachments.length} attachment${args.attachments.length === 1 ? "" : "s"}` : ""} (Gmail message ${id}).`;
  },
};
