import { nativeImage } from "electron";
import { z } from "zod";
import { runningApps } from "@/ipc/utils/process_manager";
import { getPreviewScreenshots } from "@/main/preview_web_contents_view";
import type { ToolDefinition } from "./types";

const viewPreviewSchema = z.object({});

const MAX_WIDTH = 1100;

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Shrinks the picture so one look costs roughly a thousand tokens. */
function shrinkToJpeg(dataUrl: string): string | null {
  try {
    let image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) return null;
    if (image.getSize().width > MAX_WIDTH) {
      image = image.resize({ width: MAX_WIDTH, quality: "good" });
    }
    return `data:image/jpeg;base64,${image.toJPEG(75).toString("base64")}`;
  } catch {
    return null;
  }
}

export const viewPreviewTool: ToolDefinition<z.infer<typeof viewPreviewSchema>> =
  {
    name: "view_preview",
    description:
      "Look at the app's live preview: returns a picture of what it is showing right now. Use it after a visual change, or when the user says something looks wrong. It only works while the preview is open on the user's computer and showing this app, and the model must be able to read images.",
    inputSchema: viewPreviewSchema,
    defaultConsent: "always",
    modifiesState: false,
    mutationTracking: "none",
    requiresBlueprintApproval: false,
    getConsentPreview: () => "Look at the live preview",
    execute: async (_args, ctx) => {
      const shots = getPreviewScreenshots();
      if (shots.length === 0) {
        return "No preview is open right now, so I can't see the page. Ask the user to open the Preview tab on their computer.";
      }
      const info = runningApps.get(ctx.appId);
      const appUrl = info?.proxyUrl ?? info?.cloudPreviewUrl;
      const match = appUrl
        ? shots.find((shot) => shot.url && sameOrigin(shot.url, appUrl))
        : undefined;
      if (!match) {
        return "The preview isn't showing this app right now. Ask the user to open this app's Preview tab.";
      }
      const picture = shrinkToJpeg(match.dataUrl);
      if (!picture) {
        return "The preview picture couldn't be read. Try again in a moment.";
      }
      ctx.appendUserMessage([
        {
          type: "text",
          text: "This is what the live preview is showing right now:",
        },
        { type: "image-url", url: picture },
      ]);
      return "Attached the current preview picture to the next message.";
    },
  };