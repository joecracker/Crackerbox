// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

type Listener = (evt?: any) => void;

let sockets: FakeSocket[] = [];

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  private listeners: Record<string, Listener[]> = {};
  constructor(public url: string) {
    sockets.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ||= []).push(fn);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.fire("close");
  }
  fire(type: string, evt: any = {}) {
    (this.listeners[type] ?? []).forEach((fn) => fn(evt));
  }
  open() {
    this.readyState = 1;
    this.fire("open");
  }
  receive(message: unknown) {
    this.fire("message", { data: JSON.stringify(message) });
  }
  sentTypes() {
    return this.sent.map((json) => JSON.parse(json).type);
  }
}

// Runs the real script the phone receives against a pretend browser.
function boot() {
  sockets = [];
  const documentListeners: Record<string, Listener[]> = {};
  const appended: any[] = [];
  const document: any = {
    visibilityState: "visible",
    body: { appendChild: (el: any) => appended.push(el) },
    createElement: () => ({
      style: {},
      setAttribute() {},
      textContent: "",
      onclick: null,
    }),
    addEventListener: (type: string, fn: Listener) => {
      (documentListeners[type] ||= []).push(fn);
    },
  };
  const window: any = { addEventListener() {} };
  const location = {
    protocol: "https:",
    host: "remote.example.app",
    origin: "https://remote.example.app",
    hostname: "remote.example.app",
    reload: vi.fn(),
  };
  new Function(
    "window",
    "document",
    "location",
    "WebSocket",
    PHONE_SHIM_SCRIPT,
  )(window, document, location, FakeSocket);
  return {
    window,
    document,
    location,
    appended,
    comeBack: () => documentListeners.visibilitychange?.forEach((fn) => fn()),
  };
}

describe("phone link health", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("still answers calls normally", async () => {
    const env = boot();
    sockets[0].open();
    const call = env.window.electron.ipcRenderer.invoke("some-channel", 1);
    const sent = JSON.parse(sockets[0].sent[0]);
    expect(sent).toMatchObject({
      type: "invoke",
      channel: "some-channel",
      args: [1],
    });
    sockets[0].receive({
      type: "invoke-result",
      id: sent.id,
      ok: true,
      result: "done",
    });
    await expect(call).resolves.toBe("done");
  });

  it("shows a banner and reconnects in place when the connection drops", () => {
    const env = boot();
    sockets[0].open();
    expect(env.appended).toHaveLength(0);

    sockets[0].close();
    const banner = env.appended[0];
    expect(banner.textContent).toContain("Lost connection");

    vi.advanceTimersByTime(1600);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(banner.textContent).toContain("Back online");

    banner.onclick();
    expect(env.location.reload).toHaveBeenCalledTimes(1);
  });

  it("sends anything queued while the line was down once it is back", () => {
    const env = boot();
    sockets[0].open();
    sockets[0].close();
    env.window.electron.ipcRenderer.send("some-channel", "hello");
    expect(sockets[0].sent).toHaveLength(0);

    vi.advanceTimersByTime(1600);
    sockets[1].open();
    expect(sockets[1].sent).toHaveLength(1);
    expect(JSON.parse(sockets[1].sent[0])).toMatchObject({
      type: "send",
      channel: "some-channel",
    });
  });

  it("treats a long silence as a dead line, and heartbeats keep it alive", () => {
    const env = boot();
    sockets[0].open();
    vi.advanceTimersByTime(50_000);
    sockets[0].receive({ type: "heartbeat" });
    vi.advanceTimersByTime(50_000);
    expect(env.appended).toHaveLength(0);

    vi.advanceTimersByTime(30_000);
    expect(env.appended[0].textContent).toContain("Lost connection");
  });

  it("does not judge the line while the page is hidden", () => {
    const env = boot();
    sockets[0].open();
    env.document.visibilityState = "hidden";
    vi.advanceTimersByTime(120_000);
    expect(env.appended).toHaveLength(0);
  });

  it("checks the line when you come back and gives up on a dead one", () => {
    const env = boot();
    sockets[0].open();
    vi.advanceTimersByTime(30_000);

    env.comeBack();
    expect(sockets[0].sentTypes()).toContain("ping");
    vi.advanceTimersByTime(4100);
    expect(env.appended[0].textContent).toContain("Lost connection");
  });

  it("keeps the line when the laptop answers the check", () => {
    const env = boot();
    sockets[0].open();
    vi.advanceTimersByTime(30_000);

    env.comeBack();
    vi.advanceTimersByTime(500);
    sockets[0].receive({ type: "pong" });
    vi.advanceTimersByTime(4100);
    expect(env.appended).toHaveLength(0);
  });

  it("does not reload the page while it is reconnecting in place", () => {
    const env = boot();
    sockets[0].open();
    sockets[0].close();

    env.comeBack();
    expect(env.location.reload).not.toHaveBeenCalled();
  });
});
