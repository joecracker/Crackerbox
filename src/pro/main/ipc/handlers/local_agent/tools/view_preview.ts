import { BrowserWindow, nativeImage } from "electron";
import { z } from "zod";
import { runningApps } from "@/ipc/utils/process_manager";
import { getPreviewScreenshots } from "@/main/preview_web_contents_view";
import type { ToolDefinition } from "./types";

const viewPreviewSchema = z.object({
  scroll: z
    .enum(["top", "bottom", "down", "up"])
    .optional()
    .describe(
      'Scroll the app\'s page before looking: "top", "bottom", or one screen "down" / "up" from where it is now. Leave out to look at the current position.',
    ),
  scroll_to: z
    .number()
    .optional()
    .describe(
      "Scroll to this many pixels from the top of the page before looking. Ignored if scroll is given.",
    ),
});

type ViewPreviewArgs = z.infer<typeof viewPreviewSchema>;

const MAX_WIDTH = 1100;

/** Waits are fields so tests can run them instantly. */
export const timing = { pollMs: 1000, polls: 8, settleMs: 500 };

const sleep = (ms: number) =>
  ms > 0
    ? new Promise<void>((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();

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

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What one Crackerbox window shows about the Preview panel right now. */
export interface PanelState {
  /** Where the app's preview frame is on screen, if it is showing. */
  rect: Rect | null;
  /** Preview tab pressed (panel open on the Preview tab); null: no tab buttons. */
  tabPressed: boolean | null;
  /** Header open/close button pressed (panel open); null: no such button. */
  togglePressed: boolean | null;
}

async function readPanelState(
  win: BrowserWindow,
  appId: number,
): Promise<PanelState | null> {
  const title = JSON.stringify(`Preview for App ${appId}`);
  try {
    return (await win.webContents.executeJavaScript(`/*panel-state*/ (() => {
      const frame = document.querySelector('iframe[data-testid="preview-iframe-element"]');
      let rect = null;
      if (frame && frame.title === ${title}) {
        const r = frame.getBoundingClientRect();
        if (r.width >= 20 && r.height >= 20) rect = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      const pressed = (id) => {
        const b = document.querySelector('[data-testid="' + id + '"]');
        return b ? b.getAttribute("aria-pressed") === "true" : null;
      };
      return {
        rect,
        tabPressed: pressed("preview-mode-button"),
        togglePressed: pressed("toggle-preview-panel-button"),
      };
    })()`)) as PanelState;
  } catch {
    return null;
  }
}

async function clickControl(
  win: BrowserWindow,
  testId: string,
): Promise<boolean> {
  try {
    return (await win.webContents
      .executeJavaScript(`/*click-control:${testId}*/ (() => {
      const b = document.querySelector('[data-testid="${testId}"]');
      if (!b) return false;
      b.click();
      return true;
    })()`)) as boolean;
  } catch {
    return false;
  }
}

type OpenOutcome =
  | { kind: "ready"; win: BrowserWindow; rect: Rect }
  | { kind: "no-window" }
  | { kind: "no-controls" }
  | { kind: "not-showing"; acted: boolean };

/**
 * Gets the Preview tab on screen and returns where the app's frame is.
 * It reads the real state first and presses at most one control: the Preview
 * tab when the panel is closed or on another tab, never the open/close button
 * on a panel that is already open (that would close it).
 */
async function showPreview(appId: number): Promise<OpenOutcome> {
  const windows = BrowserWindow.getAllWindows().filter(
    (w) => !w.isDestroyed() && !w.isMinimized() && w.isVisible(),
  );
  if (windows.length === 0) return { kind: "no-window" };

  let target: { win: BrowserWindow; state: PanelState } | null = null;
  for (const win of windows) {
    const state = await readPanelState(win, appId);
    if (!state) continue;
    if (state.rect) return { kind: "ready", win, rect: state.rect };
    if (
      !target &&
      (state.tabPressed !== null || state.togglePressed !== null)
    ) {
      target = { win, state };
    }
  }
  if (!target) return { kind: "no-controls" };

  const { win, state } = target;
  let acted = false;
  if (state.tabPressed === false) {
    acted = await clickControl(win, "preview-mode-button");
  } else if (state.tabPressed === null && state.togglePressed === false) {
    acted = await clickControl(win, "toggle-preview-panel-button");
  }

  for (let i = 0; i < timing.polls; i++) {
    await sleep(timing.pollMs);
    const now = await readPanelState(win, appId);
    if (now?.rect) return { kind: "ready", win, rect: now.rect };
  }
  return { kind: "not-showing", acted };
}

interface PageMeasure {
  top: number;
  viewport: number;
  total: number;
  ready: boolean;
}

/** The app's own page lives in a frame of its own; find it. */
function findAppFrame(win: BrowserWindow, appUrl: string | undefined) {
  try {
    const main = win.webContents.mainFrame;
    const frames = (main.framesInSubtree ?? []).filter(
      (f) => f !== main && f.url,
    );
    if (appUrl) {
      const match = frames.find((f) => sameOrigin(f.url, appUrl));
      if (match) return match;
    }
    return frames.find((f) => !sameOrigin(f.url, main.url)) ?? null;
  } catch {
    return null;
  }
}

/** Scrolls the app's page (when asked) and reports where it is now. */
export async function scrollAndMeasure(
  win: BrowserWindow,
  appUrl: string | undefined,
  args: ViewPreviewArgs,
): Promise<PageMeasure | null> {
  const frame = findAppFrame(win, appUrl);
  if (!frame) return null;
  const mode = args.scroll ? JSON.stringify(args.scroll) : "null";
  const to =
    !args.scroll && typeof args.scroll_to === "number"
      ? Math.max(0, Math.round(args.scroll_to))
      : "null";
  try {
    return (await frame.executeJavaScript(`/*scroll-measure*/ (() => {
      const el = document.scrollingElement || document.documentElement;
      const viewport = window.innerHeight;
      const total = el.scrollHeight;
      const max = Math.max(0, total - viewport);
      const cur = el.scrollTop;
      const mode = ${mode};
      const to = ${to};
      let next = cur;
      if (mode === "top") next = 0;
      else if (mode === "bottom") next = max;
      else if (mode === "down") next = cur + Math.round(viewport * 0.85);
      else if (mode === "up") next = cur - Math.round(viewport * 0.85);
      else if (to !== null) next = to;
      next = Math.min(max, Math.max(0, next));
      if (next !== cur) window.scrollTo({ top: next, left: 0, behavior: "instant" });
      return {
        top: Math.round(el.scrollTop),
        viewport: Math.round(viewport),
        total: Math.round(total),
        ready: document.readyState === "complete",
      };
    })()`)) as PageMeasure;
  } catch {
    return null;
  }
}

function describePosition(m: PageMeasure): string {
  const bottom = Math.min(m.total, m.top + m.viewport);
  const more =
    m.total <= m.viewport
      ? "The whole page fits on screen."
      : bottom >= m.total
        ? "This is the bottom."
        : m.top <= 0
          ? "More below: scroll down to see it."
          : "More above and below.";
  return `Showing ${m.top}-${bottom}px of a ${m.total}px tall page. ${more}`;
}

async function capture(win: BrowserWindow, rect: Rect): Promise<string | null> {
  try {
    // Let the page finish painting; a shot taken straight after an edit can
    // otherwise show the page as it was one step earlier.
    await win.webContents.executeJavaScript(
      `/*paint*/ new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`,
    );
  } catch {
    // Not fatal; the settle wait below still applies.
  }
  await sleep(timing.settleMs);
  try {
    const zoom = win.webContents.getZoomFactor();
    const image = await win.webContents.capturePage({
      x: Math.round(rect.x * zoom),
      y: Math.round(rect.y * zoom),
      width: Math.round(rect.width * zoom),
      height: Math.round(rect.height * zoom),
    });
    return image.isEmpty() ? null : image.toDataURL();
  } catch {
    return null;
  }
}

export const viewPreviewTool: ToolDefinition<ViewPreviewArgs> = {
  name: "view_preview",
  description:
    'Look at the app\'s live preview: returns a picture of what it is showing right now, and says how tall the page is and which part you are seeing. Use it after a visual change, or when the user says something looks wrong. To see more of a long page, call it again with scroll ("down", "up", "top", "bottom") or scroll_to (pixels). It opens the Preview panel and switches to the Preview tab itself, so never ask the user to open it. The Crackerbox window must not be minimized, the app must be running, and the model must be able to read images.',
  inputSchema: viewPreviewSchema,
  defaultConsent: "always",
  modifiesState: false,
  mutationTracking: "none",
  requiresBlueprintApproval: false,
  getConsentPreview: () => "Look at the live preview",
  execute: async (args, ctx) => {
    const info = runningApps.get(ctx.appId);
    const appUrl = info?.proxyUrl ?? info?.cloudPreviewUrl;

    // Test runs use a separate native preview window; check it first.
    const nativeShot = appUrl
      ? getPreviewScreenshots().find(
          (shot) => shot.url && sameOrigin(shot.url, appUrl),
        )
      : undefined;

    let source: string | null = nativeShot?.dataUrl ?? null;
    let position = "";

    if (!source) {
      const outcome = await showPreview(ctx.appId);
      if (outcome.kind === "no-window") {
        return "I can't see the Crackerbox window: it is minimized or hidden. Ask the user to bring it back up, then look again.";
      }
      if (outcome.kind === "no-controls") {
        return "I can't find the Preview controls: the Crackerbox window is not showing this app's chat page. Ask the user to open the app's chat, then look again.";
      }
      if (outcome.kind === "not-showing") {
        return outcome.acted
          ? "I switched to the Preview tab, but the app is not showing there. It is probably still starting or not running: start it (run_app / restart_app), wait for it to load, then look again. Do not tell the user the preview is open."
          : "The Preview tab is open, but the app is not showing in it. It is probably still starting or not running: start it (run_app / restart_app), wait for it to load, then look again. Do not tell the user the preview is open.";
      }
      let measure = await scrollAndMeasure(outcome.win, appUrl, args);
      // A page that is still loading gets a few more seconds.
      for (let i = 0; measure && !measure.ready && i < 3; i++) {
        await sleep(timing.pollMs);
        measure = await scrollAndMeasure(outcome.win, appUrl, {});
      }
      if (measure) position = describePosition(measure);
      source = await capture(outcome.win, outcome.rect);
      if (!source) {
        return "I found the preview but the picture came back empty. Try again in a moment.";
      }
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
    return `Attached the current preview picture to the next message.${position ? ` ${position}` : ""}`;
  },
};
