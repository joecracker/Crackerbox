import { BrowserWindow, nativeImage } from "electron";
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

/**
 * The everyday Preview is a frame inside the app window. Find that frame in
 * whichever window shows it and photograph exactly its area on screen.
 */
async function captureEmbeddedPreview(appId: number): Promise<string | null> {
  const title = JSON.stringify(`Preview for App ${appId}`);
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.isMinimized() || !win.isVisible()) continue;
    try {
      const rect = (await win.webContents.executeJavaScript(`(() => {
        const frame = document.querySelector('iframe[data-testid="preview-iframe-element"]');
        if (!frame || frame.title !== ${title}) return null;
        const r = frame.getBoundingClientRect();
        if (r.width < 20 || r.height < 20) return null;
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()`)) as { x: number; y: number; width: number; height: number } | null;
      if (!rect) continue;
      const zoom = win.webContents.getZoomFactor();
      const image = await win.webContents.capturePage({
        x: Math.round(rect.x * zoom),
        y: Math.round(rect.y * zoom),
        width: Math.round(rect.width * zoom),
        height: Math.round(rect.height * zoom),
      });
      if (!image.isEmpty()) return image.toDataURL();
    } catch {
      // Try the next window.
    }
  }
  return null;
}

/**
 * If the Preview side panel is closed, press its toggle button in the app
 * window so she does not have to ask the user to open it. Does nothing when a
 * preview frame is already on screen.
 */
async function openPreviewPanel(): Promise<boolean> {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.isMinimized() || !win.isVisible()) continue;
    try {
      const clicked = (await win.webContents.executeJavaScript(`(() => {
        if (document.querySelector('iframe[data-testid="preview-iframe-element"]')) return false;
        const b = document.querySelector('[data-testid="toggle-preview-panel-button"]');
        if (!b) return false;
        b.click();
        return true;
      })()`)) as boolean;
      if (clicked) return true;
    } catch {
      // Try the next window.
    }
  }
  return false;
}

export const viewPreviewTool: ToolDefinition<
  z.infer<typeof viewPreviewSchema>
> = {
  name: "view_preview",
  description:
    "Look at the app's live preview: returns a picture of what it is showing right now. Use it after a visual change, or when the user says something looks wrong. If the Preview panel is closed it opens it for you, so never ask the user to open it. The Crackerbox window must be visible (not minimized) and the app must be running, and the model must be able to read images.",
  inputSchema: viewPreviewSchema,
  defaultConsent: "always",
  modifiesState: false,
  mutationTracking: "none",
  requiresBlueprintApproval: false,
  getConsentPreview: () => "Look at the live preview",
  execute: async (_args, ctx) => {
    // Test runs use a separate native preview window; check it first.
    const info = runningApps.get(ctx.appId);
    const appUrl = info?.proxyUrl ?? info?.cloudPreviewUrl;
    const nativeShot = appUrl
      ? getPreviewScreenshots().find(
          (shot) => shot.url && sameOrigin(shot.url, appUrl),
        )
      : undefined;
    let source =
      nativeShot?.dataUrl ?? (await captureEmbeddedPreview(ctx.appId));
    if (!source && (await openPreviewPanel())) {
      // Give the panel and the app time to load, then look again.
      for (let i = 0; i < 6 && !source; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        source = await captureEmbeddedPreview(ctx.appId);
      }
    }
    if (!source) {
      return "I can't see this app's preview right now. I tried opening the Preview panel myself. If the app isn't running yet, start it first (run_app / restart) and try again; otherwise ask the user to keep the Crackerbox window visible (not minimized).";
    }
    const picture = shrinkToJpeg(source);
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
