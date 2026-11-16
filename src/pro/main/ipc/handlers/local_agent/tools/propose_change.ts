import { z } from "zod";
import { ToolDefinition } from "./types";
import {
  currentHead,
  normalizeFile,
  repoDir,
  savePlan,
} from "@/main/house_plan";

const proposeSchema = z.object({
  summary: z
    .string()
    .min(20)
    .max(1500)
    .describe(
      "What you want to change and why, in plain English Tim can follow without being a coder. No jargon.",
    ),
  files: z
    .array(z.string().min(1).max(300))
    .min(1)
    .max(30)
    .describe(
      "Every file in the code folder you will change or add, as paths relative to it (for example src/main/house_schedule.ts). If you later need another file, propose again.",
    ),
});

export const proposeChangeTool: ToolDefinition<z.infer<typeof proposeSchema>> =
  {
    name: "propose_change",
    description:
      "Ask Tim to approve a change to the Crackerbox code. Describe it in plain English and list every file you will touch. Tim's one yes here covers editing those files, building, and installing, as long as no other file changes. Call this BEFORE editing any file. If you need to touch a file that is not on the list, call it again.",
    inputSchema: proposeSchema,
    defaultConsent: "always",
    modifiesState: true,
    mutationTracking: "none",
    requiresBlueprintApproval: false,
    isEnabled: (ctx) => ctx.sisterId === "dextra",
    execute: async (args, ctx) => {
      const files = [...new Set(args.files.map((f) => f.trim()))];
      const preview = [
        args.summary.trim(),
        "",
        "Files she will change:",
        ...files.map((f) => `  - ${f}`),
        "",
        "Your yes covers editing these files, building, and installing. If any other file changes, you will be asked again.",
      ].join("\n");
      const ok = await ctx.requireConsent({
        toolName: "propose_change",
        toolDescription: "Approve a change to the Crackerbox code",
        inputPreview: preview,
        forceAsk: true,
      });
      if (!ok) {
        return "Tim did not approve this. Nothing is approved; talk it over with him in chat before changing anything.";
      }
      let head: string;
      try {
        head = await currentHead(repoDir());
      } catch (e) {
        return `Approved, but the plan could not be saved because the code folder could not be read (${(e as Error).message.slice(0, 160)}). Tell Tim.`;
      }
      savePlan({
        summary: args.summary.trim(),
        files: files.map((f) => normalizeFile(f)),
        head,
        approvedAt: new Date().toISOString(),
      });
      return "Approved. You may edit exactly these files, build, and install. If any other file changes, the install will ask Tim again.";
    },
  };
