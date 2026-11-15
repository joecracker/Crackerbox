import { z } from "zod";
import { ToolDefinition } from "./types";
import { requestSelfInstall, selfInstallAvailable } from "@/main/house_install";

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
      "Install the Crackerbox build you just made (after a finished `npm run make`). Tim approves it first. About 25 seconds later Crackerbox closes by itself, the installer runs, the app reopens, and a NEW chat starts for you with your note and the install result. This chat ends when the app closes, so finish what you are saying, save your handoff, and put in the note everything you need to carry on. Do not ask Tim to close the app yourself.",
    inputSchema: installSchema,
    defaultConsent: "ask",
    modifiesState: true,
    mutationTracking: "none",
    requiresBlueprintApproval: false,
    isEnabled: (ctx) => ctx.sisterId === "dextra" && selfInstallAvailable(),
    getConsentPreview: (args) =>
      `Install the new build now. Crackerbox will close and reopen by itself.\n\nAfter: ${args.note}`,
    execute: async (args, ctx) => {
      const appId = ctx.appId;
      const sisterId = ctx.sisterId;
      if (sisterId === undefined) return "Only a house member can do this.";
      const answer = await requestSelfInstall({
        sisterId,
        appId,
        note: args.note,
      });
      return answer.startsWith("OK")
        ? "Install started. Crackerbox closes in about 25 seconds and reopens when it is done; a new chat will wake you with the result. Say your goodbye now."
        : `Install not started. ${answer}`;
    },
  };
