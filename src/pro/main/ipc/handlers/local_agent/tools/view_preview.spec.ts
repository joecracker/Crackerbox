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

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => windows },
  nativeImage: { createFromDataURL: () => fakeImage() },
}));
vi.mock("@/main/preview_web_contents_view", () => ({
  getPreviewScreenshots: () => shots,
}));
vi.mock("@/ipc/utils/process_manager", () => ({ runningApps: apps }));

import { viewPreviewTool } from "./view_preview";

function makeCtx() {
  return { appId: 1, appendUserMessage: vi.fn() } as any;
}

function makeWindow(rect: object | null, opts: { visible?: boolean } = {}) {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => opts.visible ?? true,
    webContents: {
      executeJavaScript: vi.fn().mockResolvedValue(rect),
      getZoomFactor: () => 1,
      capturePage: vi.fn().mockResolvedValue({
        isEmpty: () => false,
        toDataURL: () => "data:image/png;base64,AA",
      }),
    },
  };
}

describe("view_preview", () => {
  beforeEach(() => {
    shots.length = 0;
    apps.clear();
    windows.length = 0;
  });

  it("says so when no preview is visible", async () => {
    const ctx = makeCtx();
    const result = await viewPreviewTool.execute({}, ctx);
    expect(result).toContain("can't see this app's preview");
    expect(ctx.appendUserMessage).not.toHaveBeenCalled();
  });

  it("ignores a window whose preview is a different app", async () => {
    windows.push(makeWindow(null));
    const ctx = makeCtx();
    const result = await viewPreviewTool.execute({}, ctx);
    expect(result).toContain("can't see this app's preview");
    expect(ctx.appendUserMessage).not.toHaveBeenCalled();
  });

  it("skips hidden windows", async () => {
    const hidden = makeWindow({ x: 0, y: 0, width: 800, height: 600 }, { visible: false });
    windows.push(hidden);
    const result = await viewPreviewTool.execute({}, makeCtx());
    expect(result).toContain("can't see this app's preview");
    expect(hidden.webContents.capturePage).not.toHaveBeenCalled();
  });

  it("photographs the embedded preview frame", async () => {
    const win = makeWindow({ x: 400.4, y: 80.6, width: 800.2, height: 600.1 });
    windows.push(win);
    const ctx = makeCtx();
    const result = await viewPreviewTool.execute({}, ctx);
    expect(result).toContain("Attached");
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

  it("prefers the native test-run preview when it matches", async () => {
    shots.push({ url: "http://localhost:6000/x", dataUrl: "data:image/png;base64,AA" });
    apps.set(1, { proxyUrl: "http://localhost:6000" });
    const win = makeWindow({ x: 0, y: 0, width: 800, height: 600 });
    windows.push(win);
    const result = await viewPreviewTool.execute({}, makeCtx());
    expect(result).toContain("Attached");
    expect(win.webContents.capturePage).not.toHaveBeenCalled();
  });
});