// @vitest-environment node
// The real gate in front of the phone server, driven with real HTTP requests.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({ userData: "" }));
vi.mock("@/paths/paths", () => ({ getUserDataPath: () => h.userData }));
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

import { gateHttpRequest } from "./phone_bridge_server";
import {
  PHONE_AUTH_CHECK_PATH,
  clearPhoneRefusalForTests,
  getLastPhoneRefusal,
  getPhoneAccessKey,
  resetPhoneAccessKey,
} from "./phone_bridge_auth";

let server: http.Server;
let base = "";

beforeAll(async () => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), "cb-phone-gate-"));
  clearPhoneRefusalForTests();
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    if (gateHttpRequest(req, res, pathname)) return;
    res.writeHead(200);
    res.end("PRIVATE PAGE");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(h.userData, { recursive: true, force: true });
});

const get = (url: string, cookie?: string) =>
  fetch(base + url, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });

describe("the phone server gate", () => {
  it("turns away a visitor with no key, says how to fix it, and remembers it", async () => {
    const res = await get("/");
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(text).not.toContain("PRIVATE PAGE");
    expect(text).toContain("Settings > Add a phone");
    expect(getLastPhoneRefusal()?.reason).toBe("no-key");
  });

  it("turns away a wrong key", async () => {
    const res = await get("/?cbkey=wrong");
    expect(res.status).toBe(403);
    expect(getLastPhoneRefusal()?.reason).toBe("wrong-key");
  });

  it("pairs from the QR address, then the cookie alone gets in", async () => {
    const key = getPhoneAccessKey();
    const pair = await get(`/?cbpair=1&cbkey=${key}`);
    expect(pair.status).toBe(302);
    expect(pair.headers.get("location")).toBe("/?cbpair=1");
    const setCookie = pair.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`cb_phone_key=${key}`);

    const cookie = setCookie.split(";")[0];
    const page = await get("/?cbpair=1", cookie);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("PRIVATE PAGE");
  });

  it("keeps the install file and other pages private, but not the icons", async () => {
    expect((await get("/manifest.webmanifest")).status).toBe(403);
    expect((await get("/__phone_bridge/shim.js")).status).toBe(403);
    expect((await get("/__phone_preview/42100/")).status).toBe(403);
    // public: handled by the normal server, so the gate lets them through
    expect((await get("/__phone_bridge/icon-192.png")).status).toBe(200);
  });

  it("the check address says yes with the cookie and no without it", async () => {
    const cookie = `cb_phone_key=${getPhoneAccessKey()}`;
    expect((await get(PHONE_AUTH_CHECK_PATH, cookie)).status).toBe(204);
    expect((await get(PHONE_AUTH_CHECK_PATH)).status).toBe(403);
  });

  it("locks out every phone paired before a reset", async () => {
    const oldCookie = `cb_phone_key=${getPhoneAccessKey()}`;
    expect((await get("/", oldCookie)).status).toBe(200);
    resetPhoneAccessKey();
    const res = await get("/", oldCookie);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("reset");
    expect(getLastPhoneRefusal()?.reason).toBe("wrong-key");
    expect((await get(PHONE_AUTH_CHECK_PATH, oldCookie)).status).toBe(403);
  });
});
