import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getGmailStatus, sendGmailMessage } from "@/ipc/services/gmail_service";
import { readSettings } from "@/main/settings";
import { getDyadAppsBaseDirectory } from "@/paths/paths";
import type { ToolDefinition } from "./types";
import { getToolConsent, requireToolConsentOrThrow } from "./tool_invocation";

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
        path: z
          .string()
          .min(1)
          .describe(
            "Absolute path to the local file (must be inside the Crackerbox apps folder)",
          ),
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

type SendEmailArgs = z.infer<typeof sendEmailSchema>;

function resolveReal(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function getAllowedRecipients(): string[] {
  return (readSettings().emailAllowedRecipients ?? [])
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function getBlockedRecipients(args: SendEmailArgs): string[] {
  const allowed = getAllowedRecipients();
  if (allowed.length === 0) return [];
  return [...args.to, ...(args.cc ?? []), ...(args.bcc ?? [])].filter(
    (email) => !allowed.includes(email.trim().toLowerCase()),
  );
}

function getBlockedAttachments(args: SendEmailArgs): string[] {
  const root = resolveReal(getDyadAppsBaseDirectory());
  return (args.attachments ?? [])
    .map((file) => resolveReal(file.path))
    .filter((real) => !isInside(root, real));
}

export const sendEmailTool: ToolDefinition<SendEmailArgs> = {
  name: "send_email",
  description:
    "Send an email, optionally with local file attachments, from the Gmail account connected in Crackerbox Settings. Use only when the user explicitly asks to send an email. Recipients may be limited to an allow-list in Settings, and attachments must be inside the Crackerbox apps folder. The user sees and approves the recipients, subject, message, and attachment list before it is sent.",
  inputSchema: sendEmailSchema,
  defaultConsent: "ask",
  modifiesState: true,
  mutationTracking: "none",
  requiresBlueprintApproval: false,
  isEnabled: () => getGmailStatus().connected,
  getConsentPreview: (args) => {
    const blockedRecipients = getBlockedRecipients(args);
    const blockedFiles = getBlockedAttachments(args);
    return [
      "Send email",
      `To: ${args.to.join(", ")}`,
      args.cc?.length ? `CC: ${args.cc.join(", ")}` : "",
      args.bcc?.length ? `BCC: ${args.bcc.join(", ")}` : "",
      `Subject: ${args.subject}`,
      args.attachments?.length
        ? `Attachments:\n${args.attachments.map((file) => `- ${resolveReal(file.path)}${file.filename ? ` (sent as ${file.filename})` : ""}`).join("\n")}`
        : "",
      blockedRecipients.length
        ? `\nWILL BE BLOCKED - recipient not on your allowed list: ${blockedRecipients.join(", ")}`
        : "",
      blockedFiles.length
        ? `\nWILL BE BLOCKED - attachment outside the apps folder: ${blockedFiles.join(", ")}`
        : "",
      `\n${args.body}`,
    ]
      .filter((line) => line !== "")
      .join("\n");
  },
  execute: async (args, ctx) => {
    const blockedRecipients = getBlockedRecipients(args);
    if (blockedRecipients.length) {
      throw new Error(
        `Not sent. Email is limited to: ${getAllowedRecipients().join(", ")}. Not allowed: ${blockedRecipients.join(", ")}.`,
      );
    }
    const blockedFiles = getBlockedAttachments(args);
    if (blockedFiles.length) {
      throw new Error(
        `Not sent. Attachments must be inside the Crackerbox apps folder. Not allowed: ${blockedFiles.join(", ")}.`,
      );
    }
    // Emailing always needs a fresh approval, even if "Always allow" was
    // ever saved for this tool.
    if (getToolConsent(sendEmailTool) !== "ask") {
      await requireToolConsentOrThrow(sendEmailTool, args, ctx);
    }
    const id = await sendGmailMessage({
      ...args,
      attachments: args.attachments?.map((file) => ({
        ...file,
        path: resolveReal(file.path),
      })),
    });
    return `Email sent to ${args.to.join(", ")}${args.attachments?.length ? ` with ${args.attachments.length} attachment${args.attachments.length === 1 ? "" : "s"}` : ""} (Gmail message ${id}).`;
  },
};