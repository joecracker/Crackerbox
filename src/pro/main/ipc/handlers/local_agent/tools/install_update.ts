import { z } from "zod";
import { ToolDefinition } from "./types";
import { requestSelfInstall, selfInstallAvailable } from "@/main/house_install";
import { clearPlan, evaluateInstall } from "@/main/house_plan";

const installSchema = z.object({
  note: z
    .string()
    .min(1)
    .max(1500)
    .describe(
      "What to do once Crackerbox is back (a new chat starts for you with this note and the install result).",
    ),
});

export const installUpdateTool: ToolDefinition<z.infer<typeof installSchema>> =
  {
    name: "install_update",
    description:
      "Install the Crackerbox build you just made (after a finished `npm run make`). You must have Tim's approved plan first (propose_change): if only the files on that plan changed, the install goes ahead with no further popup; if any other file changed, or there is no plan, Tim is asked again. About 25 seconds after it starts Crackerbox closes by itself, the installer runs, the app reopens, and a NEW chat starts for you with your note and the install result. This chat ends when the app closes, so finish what you are saying, save your handoff, and put in the note everything you need to carry on. Do not ask Tim to close the app yourself.",
    inputSchema: installSchema,
    // The approved plan is the yes. Tim is only asked here when the real
    // changes do not match it (checked in execute, never skipped).
    defaultConsent: "always",
    modifiesState: true,
    mutationTracking: "none",
    requiresBlueprintApproval: false,
    isEnabled: (ctx) => ctx.sisterId === "dextra" && selfInstallAvailable(),
    execute: async (args, ctx) => {
      const appId = ctx.appId;
      const sisterId = ctx.sisterId;
      if (sisterId === undefined) return "Only a house member can do this.";
      const check = await evaluateInstall();
      if (!check.ok) {
        const preview = [
          check.reason ?? "This install does not match an approved plan.",
          ...(check.extra.length
            ? ["", "Changed files:", ...check.extra.map((f) => `  - ${f}`)]
            : []),
          "",
          `After: ${args.note}`,
          "",
          "Install anyway? Crackerbox will close and reopen by itself.",
        ].join("\n");
        const ok = await ctx.requireConsent({
          toolName: "install_update",
          toolDescription: "Install a build that does not match the plan",
          inputPreview: preview,
          forceAsk: true,
        });
        if (!ok) {
          return "Install not started: Tim did not approve it. Describe the change to him in chat and use propose_change.";
        }
      }
      const answer = await requestSelfInstall({
        sisterId,
        appId,
        note: args.note,
      });
      if (!answer.startsWith("OK")) return `Install not started. ${answer}`;
      clearPlan();
      return "Install started. Crackerbox closes in about 25 seconds and reopens when it is done; a new chat will wake you with the result. Say your goodbye now.";
    },
  };
