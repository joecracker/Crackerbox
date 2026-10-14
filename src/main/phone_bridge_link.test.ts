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
function boot({ storedPageId }: { storedPageId?: string } = {}) {
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
  const stored = new Map<string, string>();
  if (storedPageId) stored.set("cbPageId", storedPageId);
  const window: any = {
    addEventListener() {},
    sessionStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  };
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
    stored,
    banner: () => appended[0],
    comeBack: () => documentListeners.visibilitychange?.forEach((fn) => fn()),
  };
}

function pageIdOf(socket: FakeSocket) {
  return new URL(socket.url).searchParams.get("pid");
}

describe("phone link", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("still answers calls normally", async () => {
    const env = boot();
    sockets[0].open();
    sockets[0].receive({ type: "hello", resumed: false });
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
    expect(env.appended).toHaveLength(0);
  });

  it("tells the laptop who it is, and keeps the same id for the tab", () => {
    const env = boot();
    const id = pageIdOf(sockets[0]);
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(env.stored.get("cbPageId")).toBe(id);

    sockets[0].open();
    sockets[0].close();
    vi.advanceTimersByTime(1600);
    expect(pageIdOf(sockets[1])).toBe(id);

    const again = boot({ storedPageId: "abcdef0123456789abcdef01" });
    expect(pageIdOf(sockets[0])).toBe("abcdef0123456789abcdef01");
    expect(again.stored.get("cbPageId")).toBe("abcdef0123456789abcdef01");
  });

  it("carries on without a refresh when the laptop recognises the page", () => {
    const env = boot();
    sockets[0].open();
    sockets[0].receive({ type: "hello", resumed: false });

    sockets[0].close();
    expect(env.banner().textContent).toContain("Lost connection");
    // Something sent while the line was down waits for the reconnect.
    env.window.electron.ipcRenderer.send("some-channel", "hello");
    expect(sockets[0].sent).toHaveLength(0);

    vi.advanceTimersByTime(1600);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    // Held until the laptop says whether it knows this page.
    expect(sockets[1].sent).toHaveLength(0);

    sockets[1].receive({ type: "hello", resumed: true });
    expect(env.banner().textContent).toContain("Reconnected");
    expect(env.location.reload).not.toHaveBeenCalled();
    expect(sockets[1].sent).toHaveLength(1);
    expect(JSON.parse(sockets[1].sent[0])).toMatchObject({
      type: "send",
      channel: "some-channel",
    });

    vi.advanceTimersByTime(2000);
    expect(env.banner().style.display).toBe("none");
    expect(env.location.reload).not.toHaveBeenCalled();
  });

  it("starts the page over when the laptop does not recognise it", () => {
    const env = boot();
    sockets[0].open();
    sockets[0].close();
    env.window.electron.ipcRenderer.send("some-channel", "hello");

    vi.advanceTimersByTime(1600);
    sockets[1].open();
    sockets[1].receive({ type: "hello", resumed: false });

    expect(env.banner().textContent).toContain("Refreshing");
    expect(env.location.reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(env.location.reload).toHaveBeenCalledTimes(1);
    // Those calls carry the old session, which the laptop would turn down.
    expect(sockets[1].sent).toHaveLength(0);
  });

  it("starts the page over if the laptop never says hello after a reconnect", () => {
    const env = boot();
    sockets[0].open();
    sockets[0].close();
    vi.advanceTimersByTime(1600);
    sockets[1].open();

    vi.advanceTimersByTime(3900);
    expect(env.location.reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(env.location.reload).toHaveBeenCalledTimes(1);
  });

  it("reconnects right away on coming back to a closed connection, without reloading", () => {
    const env = boot();
    sockets[0].open();
    // The phone froze the page; the socket is dead but no close event arrived.
    sockets[0].readyState = 3;

    env.comeBack();
    vi.advanceTimersByTime(10);
    expect(sockets).toHaveLength(2);
    expect(env.location.reload).not.toHaveBeenCalled();
  });

  it("does not open a second connection while one is already connecting", () => {
    const env = boot();
    sockets[0].open();
    sockets[0].close();

    vi.advanceTimersByTime(1600);
    expect(sockets).toHaveLength(2);
    env.comeBack();
    vi.advanceTimersByTime(5000);
    expect(sockets).toHaveLength(2);
  });

  it("treats a long silence as a dead line, and heartbeats keep it alive", () => {
    const env = boot();
    sockets[0].open();
    vi.advanceTimersByTime(50_000);
    sockets[0].receive({ type: "heartbeat" });
    vi.advanceTimersByTime(50_000);
    expect(env.appended).toHaveLength(0);

    vi.advanceTimersByTime(30_000);
    expect(env.banner().textContent).toContain("Lost connection");
  });

  it("does not judge the line while the page is hidden", () => {
    const env = boot();
    sockets[0].open();
    env.document.visibilityState = "hidden";
    vi.advanceTimersByTime(120_000);
    expect(env.appended).toHaveLength(0);
  });

  it("gives a page that just came back from the background time to hear from the laptop", () => {
    const env = boot();
    sockets[0].open();
    env.document.visibilityState = "hidden";
    vi.advanceTimersByTime(120_000);

    // Back from the camera: the last word from the laptop is two minutes old.
    env.document.visibilityState = "visible";
    vi.advanceTimersByTime(20_000);
    expect(env.appended).toHaveLength(0);

    // The next heartbeat arrives and the line stays up.
    sockets[0].receive({ type: "heartbeat" });
    vi.advanceTimersByTime(60_000);
    expect(env.appended).toHaveLength(0);
  });

  it("checks the line when you come back and gives up on a dead one", () => {
    const env = boot();
    sockets[0].open();
    vi.advanceTimersByTime(30_000);

    env.comeBack();
    expect(sockets[0].sentTypes()).toContain("ping");
    vi.advanceTimersByTime(9_000);
    expect(env.appended).toHaveLength(0);
    vi.advanceTimersByTime(1_500);
    expect(env.appended[0].textContent).toContain("Lost connection");
  });

  it("keeps the line when the laptop answers the check", () => {
    const env = boot();
    sockets[0].open();
    vi.advanceTimersByTime(30_000);

    env.comeBack();
    vi.advanceTimersByTime(500);
    sockets[0].receive({ type: "pong" });
    vi.advanceTimersByTime(11_000);
    expect(env.appended).toHaveLength(0);
  });
});
