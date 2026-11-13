// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

// Only the static file serving matters here, so Electron's pieces can be empty
// stand-ins.
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

import { serveStaticProd } from "./phone_bridge_server";

const SECRET = "TOPSECRET-OUTSIDE-THE-RENDERER-FOLDER";
const B = String.fromCharCode(92); // a backslash

let base: string;
let root: string;
let server: http.Server;
let port: number;

beforeAll(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "cb-static-"));
  root = path.join(base, "renderer");
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<head></head>INDEX");
  fs.writeFileSync(path.join(root, "assets", "a.js"), "console.log(1)");
  // A file next to the folder, one in a folder whose name starts the same as
  // the renderer folder, and one further up: none may ever be served.
  fs.writeFileSync(path.join(base, "secret.txt"), SECRET);
  fs.mkdirSync(path.join(base, "renderer-evil"));
  fs.writeFileSync(path.join(base, "renderer-evil", "secret.txt"), SECRET);

  server = http.createServer((req, res) => {
    // Same way the phone bridge turns the request into a path.
    const pathname = new URL(req.url ?? "/", "http://internal").pathname;
    serveStaticProd(root, res, pathname);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  port = (server.address() as net.AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(base, { recursive: true, force: true });
});

// A raw request, so the address reaches the server exactly as written (a
// normal client would tidy ".." before sending).
function rawGet(target: string): Promise<{ status: string; body: string }> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1", () =>
      socket.write(
        `GET ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
      ),
    );
    let raw = "";
    socket.on("data", (chunk) => (raw += chunk));
    socket.on("close", () =>
      resolve({
        status: raw.split("\r\n")[0] ?? "",
        body: raw.split("\r\n\r\n").slice(1).join("\r\n\r\n"),
      }),
    );
    socket.on("error", () => resolve({ status: "ERR", body: "" }));
  });
}

// What serveStaticProd answers when it is handed a path directly, with no URL
// tidying in front of it.
function serveDirect(pathname: string): Promise<string> {
  return new Promise((resolve) => {
    const res = {
      writeHead() {},
      end(body?: Buffer | string) {
        resolve(body === undefined ? "" : body.toString());
      },
    };
    serveStaticProd(root, res as unknown as http.ServerResponse, pathname);
  });
}

describe("phone bridge static files", () => {
  it("serves the app page, a real file and falls back to the app page", async () => {
    expect((await rawGet("/")).body).toContain("INDEX");
    expect((await rawGet("/assets/a.js")).body).toContain("console.log(1)");
    expect((await rawGet("/some/client/route")).body).toContain("INDEX");
  });

  const ESCAPES = [
    "/../secret.txt",
    "/../../secret.txt",
    "/../renderer-evil/secret.txt",
    "/assets/../../secret.txt",
    "/%2e%2e/secret.txt",
    "/%2E%2E/secret.txt",
    "/.%2e/secret.txt",
    "/%2e./secret.txt",
    "/..%2fsecret.txt",
    "/%2e%2e%2fsecret.txt",
    "/..%2Fsecret.txt",
    "/..%5csecret.txt",
    "/%2e%2e%5csecret.txt",
    "/assets/..%5c..%5csecret.txt",
    `/..${B}secret.txt`,
    `/assets/..${B}..${B}secret.txt`,
    `/${B}..${B}secret.txt`,
    "/%252e%252e/secret.txt",
    "/%252e%252e%252fsecret.txt",
    "//secret.txt",
    "/....//secret.txt",
    "/..;/secret.txt",
    "/%00/../secret.txt",
    "/index.html%00.js",
    "http://x/../secret.txt",
    "http://x/%2e%2e/secret.txt",
    "/C:/Windows/win.ini",
    `/C:${B}Windows${B}win.ini`,
    "/%43:/Windows/win.ini",
    `/${B}${B}localhost${B}c$${B}Windows${B}win.ini`,
  ];

  it.each(ESCAPES)(
    "never serves a file outside the folder for %s",
    async (t) => {
      const { body } = await rawGet(t);
      expect(body).not.toContain(SECRET);
      expect(body).not.toMatch(/\[fonts\]|for 16-bit/i);
    },
  );

  // The address cleaning in front of the server already removes most of these.
  // These go straight to the function, so the folder check itself is tested.
  it.each([
    "/../secret.txt",
    "/../../secret.txt",
    "/../renderer-evil/secret.txt",
    "/assets/../../secret.txt",
    `/..${B}secret.txt`,
    `/assets/..${B}..${B}secret.txt`,
  ])("the folder check alone refuses %s", async (pathname) => {
    const body = await serveDirect(pathname);
    expect(body).not.toContain(SECRET);
    expect(body).toContain("INDEX");
  });
});
