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
function loadRewrite(
  where = {
    origin: "https://remote.example.app",
    protocol: "https:",
    hostname: "remote.example.app",
  },
): (value: unknown) => unknown {
  const start = PHONE_SHIM_SCRIPT.indexOf("function rewritePreviewUrl(value)");
  const end = PHONE_SHIM_SCRIPT.indexOf("function rewritePreviewUrls(value)");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const source = PHONE_SHIM_SCRIPT.slice(start, end);
  return new Function("location", source + "; return rewritePreviewUrl;")(
    where,
  );
}

describe("two pages sharing one page id", () => {
  it("has the pushed-out page take a new id and refresh instead of reconnecting", () => {
    // Server tells the page it was replaced; the page must not just reconnect.
    expect(PHONE_SHIM_SCRIPT).toContain('msg.type === "replaced"');
    expect(PHONE_SHIM_SCRIPT).toContain("evt.code === 4000");
    expect(PHONE_SHIM_SCRIPT).toContain("function takeNewPageId()");
    // A new random id is stored, then the page refreshes onto it.
    const start = PHONE_SHIM_SCRIPT.indexOf("function takeNewPageId()");
    const body = PHONE_SHIM_SCRIPT.slice(start, start + 400);
    expect(body).toContain('setItem("cbPageId", randomId())');
    expect(body).toContain("location.reload()");
  });

  it("ignores a replaced notice that arrives on an old connection", () => {
    expect(PHONE_SHIM_SCRIPT).toContain(
      "if (thisSocket === socket) takeNewPageId();",
    );
    expect(PHONE_SHIM_SCRIPT).toContain("if (thisSocket !== socket) return;");
  });
});

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

  it("over https (Cloudflare) serves the preview on the second port, naming which preview", () => {
    expect(rewrite("http://localhost:42137/")).toBe(
      "https://remote.example.app:8443/?cbp=42137",
    );
    expect(rewrite("http://127.0.0.1:42137/page?x=1")).toBe(
      "https://remote.example.app:8443/page?x=1&cbp=42137",
    );
    expect(rewrite("http://localhost:42137")).toBe(
      "https://remote.example.app:8443/?cbp=42137",
    );
  });

  it("over plain http (home Wi-Fi) keeps the preview's own port on the computer's address", () => {
    const lan = loadRewrite({
      origin: "http://192.168.1.16:4319",
      protocol: "http:",
      hostname: "192.168.1.16",
    });
    expect(lan("http://localhost:42137/")).toBe("http://192.168.1.16:42137/");
    expect(lan("http://127.0.0.1:42137/page?x=1")).toBe(
      "http://192.168.1.16:42137/page?x=1",
    );
  });

  it("never lets Crackerbox start inside another page", () => {
    expect(PHONE_SHIM_SCRIPT).toContain("window.top !== window");
    expect(PHONE_SHIM_SCRIPT).toContain("window.stop()");
  });
  it("leaves addresses outside the preview port range alone", () => {
    expect(rewrite("http://localhost:5173/")).toBe("http://localhost:5173/");
    expect(rewrite("https://example.com/")).toBe("https://example.com/");
  });

  it("leaves text without a picture address alone", () => {
    expect(rewrite("just words")).toBe("just words");
    expect(rewrite(42)).toBe(42);
  });
});
