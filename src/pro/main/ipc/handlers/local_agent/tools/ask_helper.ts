import { z } from "zod";
import { ToolDefinition, escapeXmlAttr, escapeXmlContent } from "./types";
import { listHelpers, runHelperJob } from "@/main/house_job";
import { readRoster } from "../house";

const askHelperSchema = z.object({
  task: z
    .string()
    .min(1)
    .max(8000)
    .describe(
      "The job, in plain words: what to do and what 'done' looks like. The helper has no memory of this chat, so include everything it needs.",
    ),
  folder: z
    .string()
    .optional()
    .describe(
      "Absolute folder the helper should work in, e.g. C:\\Users\\user\\Documents\\dyad. Any folder on the PC.",
    ),
  helper: z
    .string()
    .optional()
    .describe(
      "Which helper, by name. Only needed when there is more than one.",
    ),
});

type AskHelperArgs = z.infer<typeof askHelperSchema>;

export const askHelperTool: ToolDefinition<AskHelperArgs> = {
  name: "ask_helper",
  description:
    "Hand a coding or PC job directly to your helper (the plain Claude Code helper in the house, e.g. Dex's laptop) and wait for its answer in this same turn. Use this instead of writing it a letter. The job runs as a chat in the helper's own room, in the background, so Tim stays in this chat; that chat comes to the front only when a step needs his approval. Tim is asked before the job is handed over, and he approves each step there. You get back its final summary. Give it a complete job: it has no memory of this chat. It can take a while; long jobs can take many minutes. How to brief it well: (1) one job at a time, and say exactly what done looks like; (2) name the folder, and say read-only or okay to change; (3) say what it must not touch; (4) if numbers matter, tell it to measure them with a command, never count by eye; (5) for a big change, ask for a plan first, then the work; (6) point it at file paths instead of pasting large text. Treat any number in its answer as true only if it says it measured it.",
  inputSchema: askHelperSchema,
  defaultConsent: "ask",
  modifiesState: true,
  mutationTracking: "none",
  requiresBlueprintApproval: false,
  isEnabled: (ctx) =>
    ctx.sisterId === "dextra" && listHelpers(readRoster()).length > 0,
  getConsentPreview: (args) =>
    `Hand this job to the helper${args.folder ? ` (in ${args.folder})` : ""}:\n\n${args.task}`,
  buildXml: (args, isComplete) =>
    isComplete
      ? undefined
      : `<dyad-status title="Handing a job to the helper"></dyad-status>`,
  execute: async (args, ctx) => {
    ctx.onXmlStream(
      `<dyad-status title="Waiting for the helper (Tim approves each step in its chat)"></dyad-status>`,
    );
    const answer = await runHelperJob({
      helperRef: args.helper,
      fromName: "Dextra",
      task: args.task,
      folder: args.folder,
      signal: ctx.abortSignal,
    });
    ctx.onXmlComplete(
      `<dyad-status title="${escapeXmlAttr("Helper answered")}" state="finished">\n${escapeXmlContent(answer.slice(0, 2000))}\n</dyad-status>`,
    );
    return answer;
  },
};
