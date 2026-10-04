// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

// Only the shim text matters here, so Electron's pieces can be empty stand-ins.
vi.mock("electron", () => {
  const stub = () => ({
    handle() {},
    on() {},
    once() {},
    removeHandler() {},
    removeListener() {},
    getAllWindows: () => [],
  });
  return {
    app: {
      getPath: () => "",
      getVersion: () => "1",
      on() {},
      isPackaged: false,
    },
    ipcMain: stub(),
    BrowserWindow: stub(),
    shell: stub(),
    dialog: stub(),
    protocol: stub(),
    net: stub(),
    session: stub(),
    safeStorage: stub(),
    nativeTheme: stub(),
    screen: stub(),
    webContents: stub(),
  };
});
vi.mock("electron-log", () => {
  const scope = { info() {}, debug() {}, warn() {}, error() {} };
  return { default: { scope: () => scope } };
});

import { PHONE_SHIM_SCRIPT } from "./phone_bridge_server";

// Pull the real rewrite function out of the script the phone actually receives.
function loadRewrite(): (value: unknown) => unknown {
  const start = PHONE_SHIM_SCRIPT.indexOf("function rewritePreviewUrl(value)");
  const end = PHONE_SHIM_SCRIPT.indexOf("function rewritePreviewUrls(value)");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const source = PHONE_SHIM_SCRIPT.slice(start, end);
  const location = {
    origin: "https://remote.example.app",
    protocol: "https:",
    hostname: "remote.example.app",
  };
  return new Function("location", source + "; return rewritePreviewUrl;")(
    location,
  );
}

describe("phone address rewriting", () => {
  const rewrite = loadRewrite();

  it("rewrites a bare picture address", () => {
    expect(rewrite("dyad-media://media/apps/a/pic.png")).toBe(
      "https://remote.example.app/__phone_bridge/media/apps/a/pic.png",
    );
  });

  it("rewrites pictures inside chat text (markdown)", () => {
    const text =
      "Here you go:\n\n![shot](dyad-media://media/chat/1/a.png) and ![two](dyad-media://media/chat/1/b.png)";
    expect(rewrite(text)).toBe(
      "Here you go:\n\n![shot](https://remote.example.app/__phone_bridge/media/chat/1/a.png) and ![two](https://remote.example.app/__phone_bridge/media/chat/1/b.png)",
    );
  });

  it("leaves text without a picture address alone", () => {
    expect(rewrite("just words")).toBe("just words");
    expect(rewrite(42)).toBe(42);
  });
});
