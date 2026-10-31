import { beforeEach, describe, expect, it, vi } from "vitest";

const { shots, apps, windows } = vi.hoisted(() => ({
  shots: [] as Array<{ url: string | null; dataUrl: string }>,
  apps: new Map<number, { proxyUrl?: string }>(),
  windows: [] as any[],
}));

const fakeImage = () => ({
  isEmpty: () => false,
  getSize: () => ({ width: 2000, height: 1000 }),
  resize: () => ({
    getSize: () => ({ width: 1100, height: 550 }),
    toJPEG: () => Buffer.from("jpeg-bytes"),
  }),
  toJPEG: () => Buffer.from("jpeg-bytes"),
});

const hidden = vi.hoisted(() => ({
  created: [] as any[],
  loadError: null as Error | null,
  empty: false,
  measure: { top: 0, viewport: 800, total: 2400, ready: true } as object,
}));

vi.mock("electron", () => {
  class FakeBrowserWindow {
    static getAllWindows() {
      return windows;
    }
    opts: any;
    destroyed = false;
    webContents = {
      setWindowOpenHandler: vi.fn(),
      executeJavaScript: vi.fn(async () => hidden.measure),
      capturePage: vi.fn(async () => ({
        isEmpty: () => hidden.empty,
        toDataURL: () => "data:image/png;base64,HIDDEN",
      })),
    };
    loadURL = vi.fn(async () => {
      if (hidden.loadError) throw hidden.loadError;
    });
    constructor(opts: any) {
      this.opts = opts;
      hidden.created.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return {
    BrowserWindow: FakeBrowserWindow,
    nativeImage: { createFromDataURL: () => fakeImage() },
  };
});
vi.mock("@/main/preview_web_contents_view", () => ({
  getPreviewScreenshots: () => shots,
}));
vi.mock("@/ipc/utils/process_manager", () => ({ runningApps: apps }));

import { timing, viewPreviewTool } from "./view_preview";

const RECT = { x: 400.4, y: 80.6, width: 800.2, height: 600.1 };

function makeCtx() {
  return { appId: 1, appendUserMessage: vi.fn() } as any;
}

interface FakeState {
  rect: object | null;
  tabPressed: boolean | null;
  togglePressed: boolean | null;
}

/**
 * A window whose Preview panel state can change when a control is clicked.
 * `onTabClick` / `onToggleClick` return the state the panel ends up in.
 */
function makeWindow(
  initial: FakeState,
  opts: {
    visible?: boolean;
    minimized?: boolean;
    onTabClick?: (s: FakeState) => FakeState;
    onToggleClick?: (s: FakeState) => FakeState;
    frames?: any[];
  } = {},
) {
  let state = { ...initial };
  const clicks: string[] = [];
  const executeJavaScript = vi.fn(async (script: string) => {
    if (script.includes("/*panel-state*/")) return { ...state };
    if (script.includes("/*click-control:preview-mode-button*/")) {
      clicks.push("tab");
      if (state.tabPressed === null) return false;
      if (opts.onTabClick) state = opts.onTabClick(state);
      return true;
    }
    if (script.includes("/*click-control:toggle-preview-panel-button*/")) {
      clicks.push("toggle");
      if (state.togglePressed === null) return false;
      if (opts.onToggleClick) state = opts.onToggleClick(state);
      return true;
    }
    return undefined;
  });
  const main = {
    url: "app://renderer/index.html",
    framesInSubtree: [] as any[],
  };
  main.framesInSubtree = [main, ...(opts.frames ?? [])];
  return {
    clicks,
    isDestroyed: () => false,
    isMinimized: () => opts.minimized ?? false,
    isVisible: () => opts.visible ?? true,
    webContents: {
      executeJavaScript,
      mainFrame: main,
      getZoomFactor: () => 1,
      capturePage: vi.fn().mockResolvedValue({
        isEmpty: () => false,
        toDataURL: () => "data:image/png;base64,AA",
      }),
    },
  };
}

const showing: FakeState = {
  rect: RECT,
  tabPressed: true,
  togglePressed: true,
};
const closed: FakeState = {
  rect: null,
  tabPressed: false,
  togglePressed: false,
};
const otherTab: FakeState = {
  rect: null,
  tabPressed: false,
  togglePressed: true,
};
const openNoApp: FakeState = {
  rect: null,
  tabPressed: true,
  togglePressed: true,
};

describe("view_preview", () => {
  beforeEach(() => {
    shots.length = 0;
    apps.clear();
    windows.length = 0;
    timing.pollMs = 0;
    timing.polls = 3;
    timing.settleMs = 0;
    hidden.created.length = 0;
    hidden.loadError = null;
    hidden.empty = false;
    hidden.measure = { top: 0, viewport: 800, total: 2400, ready: true };
  });

  it("says the app is not running when the window is hidden and there is no app address", async () => {
    windows.push(makeWindow(showing, { visible: false }));
    const ctx = makeCtx();
    const result = await viewPreviewTool.execute({}, ctx);
    expect(result).toContain("minimized or not on this app's chat");
    expect(result).toContain("not running");
    expect(ctx.appendUserMessage).not.toHaveBeenCalled();
    expect(hidden.created).toHaveLength(0);
  });

  describe("when Crackerbox's own window can't show it", () => {
    it("looks at the running app from a hidden window when the window is minimized", async () => {
      apps.set(1, { proxyUrl: "http://localhost:6000" });
      windows.push(makeWindow(showing, { minimized: true }));
      const ctx = makeCtx();
      const result = await viewPreviewTool.execute({}, ctx);
      expect(hidden.created).toHaveLength(1);
      const win = hidden.created[0];
      expect(win.opts.show).toBe(false);
      expect(win.opts.webPreferences.sandbox).toBe(true);
      expect(win.opts.webPreferences.nodeIntegration).toBe(false);
      expect(win.loadURL).toHaveBeenCalledWith("http://localhost:6000");
      expect(win.destroyed).toBe(true);
      expect(result).toContain("taken from a hidden window");
      expect(result).toContain("Showing 0-800px of a 2400px tall page");
      const parts = ctx.appendUserMessage.mock.calls[0][0];
      expect(parts[1].type).toBe("image-url");
    });

    it("does the same when the window has no preview controls (another page)", async () => {
      apps.set(1, { proxyUrl: "http://localhost:6000" });
      windows.push(
        makeWindow({ rect: null, tabPressed: null, togglePressed: null }),
      );
      const result = await viewPreviewTool.execute({}, makeCtx());
      expect(result).toContain("taken from a hidden window");
      expect(hidden.created[0].destroyed).toBe(true);
    });

    it("scrolls the hidden copy too", async () => {
      apps.set(1, { proxyUrl: "http://localhost:6000" });
      hidden.measure = { top: 680, viewport: 800, total: 2400, ready: true };
      windows.push(makeWindow(showing, { minimized: true }));
      const result = await viewPreviewTool.execute(
        { scroll: "down" },
        makeCtx(),
      );
      const script = hidden.created[0].webContents.executeJavaScript.mock
        .calls[0][0] as string;
      expect(script).toContain('const mode = "down"');
      expect(result).toContain("Showing 680-1480px");
    });

    it("reports a failed load plainly and still closes the hidden window", async () => {
      apps.set(1, { proxyUrl: "http://localhost:6000" });
      hidden.loadError = new Error("ERR_CONNECTION_REFUSED");
      windows.push(makeWindow(showing, { minimized: true }));
      const ctx = makeCtx();
      const result = await viewPreviewTool.execute({}, ctx);
      expect(result).toContain("ERR_CONNECTION_REFUSED");
      expect(ctx.appendUserMessage).not.toHaveBeenCalled();
      expect(hidden.created[0].destroyed).toBe(true);
    });

    it("reports an empty picture", async () => {
      apps.set(1, { proxyUrl: "http://localhost:6000" });
      hidden.empty = true;
      windows.push(makeWindow(showing, { minimized: true }));
      const result = await viewPreviewTool.execute({}, makeCtx());
      expect(result).toContain("came back empty");
    });

    it("does not use a hidden window when the real one shows the preview", async () => {
      apps.set(1, { proxyUrl: "http://localhost:6000" });
      windows.push(makeWindow(showing));
      await viewPreviewTool.execute({}, makeCtx());
      expect(hidden.created).toHaveLength(0);
    });
  });

  it("photographs the embedded preview frame without pressing anything", async () => {
    const win = makeWindow(showing);
    windows.push(win);
    const ctx = makeCtx();
    const result = await viewPreviewTool.execute({}, ctx);
    expect(result).toContain("Attached");
    expect(win.clicks).toEqual([]);
    expect(win.webContents.capturePage).toHaveBeenCalledWith({
      x: 400,
      y: 81,
      width: 800,
      height: 600,
    });
    const parts = ctx.appendUserMessage.mock.calls[0][0];
    expect(parts[1].type).toBe("image-url");
    expect(parts[1].url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("opens a closed panel by pressing the Preview tab once", async () => {
    const win = makeWindow(closed, {
      onTabClick: () => showing,
    });
    windows.push(win);
    const result = await viewPreviewTool.execute({}, makeCtx());
    expect(result).toContain("Attached");
    expect(win.clicks).toEqual(["tab"]);
  });

  it("switches a panel that is open on another tab to Preview instead of closing it", async () => {
    const win = makeWindow(otherTab, {
      onTabClick: () => showing,
    });
    windows.push(win);
    const result = await viewPreviewTool.execute({}, makeCtx());
    expect(result).toContain("Attached");
    expect(win.clicks).toEqual(["tab"]);
    expect(win.clicks).not.toContain("toggle");
  });

  it("never presses anything when Preview is already open but the app is not showing", async () => {
    const win = makeWindow(openNoApp);
    windows.push(win);
    const ctx = makeCtx();
    const result = await viewPreviewTool.execute({}, ctx);
    expect(win.clicks).toEqual([]);
    expect(result).toContain("not showing");
    expect(result).toContain("Do not tell the user the preview is open");
    expect(ctx.appendUserMessage).not.toHaveBeenCalled();
  });

  it("reports honestly when the tab was pressed but the app still does not show", async () => {
    const win = makeWindow(closed, {
      onTabClick: () => openNoApp,
    });
    windows.push(win);
    const result = await viewPreviewTool.execute({}, makeCtx());
    expect(win.clicks).toEqual(["tab"]);
    expect(result).toContain("I switched to the Preview tab");
  });

  it("falls back to the header button only when there are no tab buttons and the panel is closed", async () => {
    const win = makeWindow(
      { rect: null, tabPressed: null, togglePressed: false },
      { onToggleClick: () => showing },
    );
    windows.push(win);
    const result = await viewPreviewTool.execute({}, makeCtx());
    expect(win.clicks).toEqual(["toggle"]);
    expect(result).toContain("Attached");
  });

  it("prefers the native test-run preview when it matches", async () => {
    shots.push({
      url: "http://localhost:6000/x",
      dataUrl: "data:image/png;base64,AA",
    });
    apps.set(1, { proxyUrl: "http://localhost:6000" });
    const win = makeWindow(showing);
    windows.push(win);
    const result = await viewPreviewTool.execute({}, makeCtx());
    expect(result).toContain("Attached");
    expect(win.webContents.capturePage).not.toHaveBeenCalled();
  });

  describe("scrolling", () => {
    function appFrame(measure: object) {
      return {
        url: "http://localhost:6000/",
        executeJavaScript: vi.fn().mockResolvedValue(measure),
      };
    }

    it("scrolls the app's own page and says where it is", async () => {
      apps.set(1, { proxyUrl: "http://localhost:6000" });
      const frame = appFrame({
        top: 900,
        viewport: 900,
        total: 3200,
        ready: true,
      });
      windows.push(makeWindow(showing, { frames: [frame] }));
      const result = await viewPreviewTool.execute(
        { scroll: "down" },
        makeCtx(),
      );
      const script = frame.executeJavaScript.mock.calls[0][0] as string;
      expect(script).toContain('const mode = "down"');
      expect(result).toContain("Showing 900-1800px of a 3200px tall page");
      expect(result).toContain("More above and below");
    });

    it("passes a pixel offset through when scroll is not given", async () => {
      apps.set(1, { proxyUrl: "http://localhost:6000" });
      const frame = appFrame({
        top: 1500,
        viewport: 900,
        total: 3200,
        ready: true,
      });
      windows.push(makeWindow(showing, { frames: [frame] }));
      await viewPreviewTool.execute({ scroll_to: 1500 }, makeCtx());
      const script = frame.executeJavaScript.mock.calls[0][0] as string;
      expect(script).toContain("const mode = null");
      expect(script).toContain("const to = 1500");
    });

    it("says when this is the bottom or the whole page fits", async () => {
      apps.set(1, { proxyUrl: "http://localhost:6000" });
      const bottom = appFrame({
        top: 2300,
        viewport: 900,
        total: 3200,
        ready: true,
      });
      windows.push(makeWindow(showing, { frames: [bottom] }));
      expect(
        await viewPreviewTool.execute({ scroll: "bottom" }, makeCtx()),
      ).toContain("This is the bottom.");

      windows.length = 0;
      const fits = appFrame({ top: 0, viewport: 900, total: 700, ready: true });
      windows.push(makeWindow(showing, { frames: [fits] }));
      expect(await viewPreviewTool.execute({}, makeCtx())).toContain(
        "The whole page fits on screen.",
      );
    });

    it("still looks when the app's frame cannot be found", async () => {
      windows.push(makeWindow(showing));
      const result = await viewPreviewTool.execute(
        { scroll: "down" },
        makeCtx(),
      );
      expect(result).toContain("Attached");
      expect(result).not.toContain("tall page");
    });

    it("waits for a page that is still loading", async () => {
      apps.set(1, { proxyUrl: "http://localhost:6000" });
      const frame = {
        url: "http://localhost:6000/",
        executeJavaScript: vi
          .fn()
          .mockResolvedValueOnce({
            top: 0,
            viewport: 900,
            total: 900,
            ready: false,
          })
          .mockResolvedValue({
            top: 0,
            viewport: 900,
            total: 2000,
            ready: true,
          }),
      };
      windows.push(makeWindow(showing, { frames: [frame] }));
      const result = await viewPreviewTool.execute({}, makeCtx());
      expect(frame.executeJavaScript).toHaveBeenCalledTimes(2);
      expect(result).toContain("of a 2000px tall page");
    });
  });
});
