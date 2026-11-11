import { BrowserWindow } from "electron";
import { z } from "zod";
import { clickControl, panelShowing, readPanelState } from "./view_preview";
import type { ToolDefinition } from "./types";

const previewPanelSchema = z.object({
  action: z
    .enum(["open", "close", "status"])
    .describe(
      "open: show the Preview panel on the Preview tab. close: hide the panel. status: say whether it is showing.",
    ),
});

type PreviewPanelArgs = z.infer<typeof previewPanelSchema>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const previewPanelTool: ToolDefinition<PreviewPanelArgs> = {
  name: "preview_panel",
  description:
    "Open or close the Preview panel in Crackerbox's window, or check whether it is showing. view_preview opens the panel on its own; use this to close it again afterwards, or pass quiet to view_preview to look without opening it.",
  inputSchema: previewPanelSchema,
  defaultConsent: "always",
  modifiesState: false,
  mutationTracking: "none",
  requiresBlueprintApproval: false,
  getConsentPreview: (args) => `Preview panel: ${args.action}`,
  execute: async (args, ctx) => {
    const showing = await panelShowing(ctx.appId);
    if (args.action === "status") {
      return showing ? "The Preview panel is showing." : "The Preview panel is not showing.";
    }
    if (args.action === "open" && showing) return "The Preview panel is already open.";

    const windows = BrowserWindow.getAllWindows().filter(
      (w) => !w.isDestroyed() && !w.isMinimized() && w.isVisible(),
    );
    for (const win of windows) {
      const state = await readPanelState(win, ctx.appId);
      if (!state) continue;
      if (args.action === "close") {
        if (state.togglePressed === true) {
          await clickControl(win, "toggle-preview-panel-button");
        } else if (!showing) {
          return "The Preview panel is already closed.";
        } else {
          continue;
        }
      } else if (state.tabPressed === false) {
        await clickControl(win, "preview-mode-button");
      } else if (state.togglePressed === false) {
        await clickControl(win, "toggle-preview-panel-button");
      } else {
        continue;
      }
      await sleep(700);
      const now = await panelShowing(ctx.appId);
      return args.action === "open"
        ? now
          ? "The Preview panel is open."
          : "I pressed the control, but the app is not showing in the panel yet (it may still be starting)."
        : now
          ? "I pressed the control, but the panel still looks open."
          : "The Preview panel is closed.";
    }
    return "Crackerbox's window can't show the panel right now (minimized or not on this app's chat).";
  },
};