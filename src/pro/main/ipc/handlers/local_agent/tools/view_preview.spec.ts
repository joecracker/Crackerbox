import { beforeEach, describe, expect, it, vi } from "vitest";

const { shots, apps } = vi.hoisted(() => ({
  shots: [] as Array<{ url: string | null; dataUrl: string }>,
  apps: new Map<number, { proxyUrl?: string }>(),
}));

vi.mock("electron", () => ({
  nativeImage: {
    createFromDataURL: () => ({
      isEmpty: () => false,
      getSize: () => ({ width: 2000, height: 1000 }),
      resize: () => ({
        getSize: () => ({ width: 1100, height: 550 }),
        toJPEG: () => Buffer.from("jpeg-bytes"),
      }),
      toJPEG: () => Buffer.from("jpeg-bytes"),
    }),
  },
}));
vi.mock("@/main/preview_web_contents_view", () => ({
  getPreviewScreenshots: () => shots,
}));
vi.mock("@/ipc/utils/process_manager", () => ({ runningApps: apps }));

import { viewPreviewTool } from "./view_preview";

function makeCtx() {
  return { appId: 1, appendUserMessage: vi.fn() } as any;
}

describe("view_preview", () => {
  beforeEach(() => {
    shots.length = 0;
    apps.clear();
  });

  it("says so when no preview is open", async () => {
    const ctx = makeCtx();
    const result = await viewPreviewTool.execute({}, ctx);
    expect(result).toContain("No preview is open");
    expect(ctx.appendUserMessage).not.toHaveBeenCalled();
  });

  it("refuses a preview that is showing a different app", async () => {
    shots.push({ url: "http://localhost:5555/", dataUrl: "data:image/png;base64,AA" });
    apps.set(1, { proxyUrl: "http://localhost:6000" });
    const ctx = makeCtx();
    const result = await viewPreviewTool.execute({}, ctx);
    expect(result).toContain("isn't showing this app");
    expect(ctx.appendUserMessage).not.toHaveBeenCalled();
  });

  it("attaches a shrunk picture of the matching preview", async () => {
    shots.push({ url: "http://localhost:6000/index.html?x=1", dataUrl: "data:image/png;base64,AA" });
    apps.set(1, { proxyUrl: "http://localhost:6000" });
    const ctx = makeCtx();
    const result = await viewPreviewTool.execute({}, ctx);
    expect(result).toContain("Attached");
    const parts = ctx.appendUserMessage.mock.calls[0][0];
    expect(parts[1].type).toBe("image-url");
    expect(parts[1].url).toMatch(/^data:image\/jpeg;base64,/);
  });
});