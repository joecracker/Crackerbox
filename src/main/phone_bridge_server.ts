// Milestone 1 of Step 10 (phone access): a LAN-only HTTP + WebSocket server
// that lets a plain phone browser load Crackerbox's renderer and drive it
// exactly like the desktop window does, by replaying the same
// window.electron.ipcRenderer contract preload.ts exposes -- but over a
// WebSocket instead of Electron's real contextBridge/IPC.
//
// No login yet (LAN only, trusted network assumed). Milestone 2 puts this
// behind Cloudflare Access before it's reachable from the open internet.
import { EventEmitter } from "node:events";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { URL } from "node:url";
import { app } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import log from "electron-log";
import {
  getRegisteredInvokeHandler,
  getRegisteredOnListeners,
} from "./ipc_bridge_registry";
import {
  VALID_INVOKE_CHANNELS,
  VALID_SEND_CHANNELS,
} from "../ipc/preload/channels";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "../ipc/contracts/core";
import { PHONE_BRIDGE_TRUST_MARKER } from "../ipc/utils/renderer_security";
import { PHONE_MEDIA_PATH_PREFIX, servePhoneMedia } from "./phone_bridge_media";

const logger = log.scope("phone_bridge_server");

const PHONE_BRIDGE_PORT = 4319;
const WS_PATH = "/__phone_bridge/ws";
const SHIM_PATH = "/__phone_bridge/shim.js";
const SHIM_SRC = `${SHIM_PATH}?v=3`;
const PREVIEW_PATH_PREFIX = "/__phone_preview/";
const MIN_PREVIEW_PROXY_PORT = 42_100;
const MAX_PREVIEW_PROXY_PORT = 52_149;

function isValidInvokeChannel(channel: string): boolean {
  return (VALID_INVOKE_CHANNELS as readonly string[]).includes(channel);
}
function isValidSendChannel(channel: string): boolean {
  return (VALID_SEND_CHANNELS as readonly string[]).includes(channel);
}

// ---------------------------------------------------------------------------
// Per-connection fake sender/event, standing in for a real WebContents.
// Originally scoped to chat_stream_handlers.ts's needs (just `.send(...)` --
// see SafeSender in src/ipc/utils/safe_sender.ts), but other main-process
// code now treats event.sender as a real WebContents too -- e.g.
// first_prompt_creation_service.ts's `.once("destroyed", ...)` /
// `.once("render-process-gone", ...)`/`.removeListener(...)` calls, used to
// cancel/clean up an in-flight "New app" creation if its owning window goes
// away. Without a real EventEmitter here that threw synchronously the moment
// a phone client created a new app (`sender.once is not a function`) --
// caught by createTypedHandler and surfaced as a normal error, not a hang,
// but it still broke "New app" from the phone. Fixed: a real EventEmitter,
// firing "destroyed"/"render-process-gone" when the socket closes so a phone
// disconnect mid-creation cancels/cleans up like a closed window would.
// ---------------------------------------------------------------------------
// Electron WebContents IDs are positive integers. Keep browser-backed phone
// connections in a separate ID space so registering a phone stream can never
// alias the desktop window that happens to have the same numeric ID.
let nextPhoneConnectionId = -1;

class PhoneConnection {
  readonly sender: {
    id: number;
    isDestroyed: () => boolean;
    isCrashed: () => boolean;
    send: (channel: string, ...args: unknown[]) => void;
    once: (event: string, listener: (...args: unknown[]) => void) => void;
    removeListener: (
      event: string,
      listener: (...args: unknown[]) => void,
    ) => void;
  };

  private readonly emitter = new EventEmitter();

  constructor(private readonly ws: WebSocket) {
    const senderId = nextPhoneConnectionId--;
    this.sender = {
      id: senderId,
      isDestroyed: () => this.ws.readyState !== WebSocket.OPEN,
      isCrashed: () => false,
      send: (channel: string, ...args: unknown[]) => {
        if (this.ws.readyState !== WebSocket.OPEN) return;
        try {
          this.ws.send(JSON.stringify({ type: "event", channel, args }));
        } catch (error) {
          logger.debug(
            `failed to push event on channel "${channel}": ${(error as Error).message}`,
          );
        }
      },
      once: (event, listener) => this.emitter.once(event, listener),
      removeListener: (event, listener) =>
        this.emitter.removeListener(event, listener),
    };
  }

  notifyClosed(): void {
    this.emitter.emit("destroyed");
    this.emitter.emit("render-process-gone");
  }

  fakeEvent(): IpcMainInvokeEvent & IpcMainEvent {
    // See renderer_security.ts: this is the sole, explicit, auditable
    // exception to the real-renderer trust check, scoped to LAN-only
    // Milestone 1. Nothing else can set this Symbol-keyed property.
    return {
      sender: this.sender,
      senderFrame: null,
      [PHONE_BRIDGE_TRUST_MARKER]: true,
    } as unknown as IpcMainInvokeEvent & IpcMainEvent;
  }
}

async function handleInvoke(
  conn: PhoneConnection,
  channel: string,
  args: unknown[],
  unwrapEnvelope: boolean,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  if (!isValidInvokeChannel(channel)) {
    return { ok: false, error: `Invalid channel: ${channel}` };
  }
  const handler = getRegisteredInvokeHandler(channel);
  if (!handler) {
    return {
      ok: false,
      error: `No handler registered for channel: ${channel}`,
    };
  }
  try {
    let result = await handler(conn.fakeEvent(), ...args);
    if (unwrapEnvelope) {
      // matches invokeEnvelope() in preload.ts: raw envelope, no unwrap
    } else if (isIpcInvokeEnvelope(result)) {
      // matches invoke() in preload.ts: auto-unwrap {ok,value}/{ok,error}
      result = unwrapIpcEnvelope(result);
    }
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: (error as Error).message ?? String(error) };
  }
}

function handleSend(conn: PhoneConnection, channel: string, args: unknown[]) {
  if (!isValidSendChannel(channel)) {
    logger.warn(`Rejected send on invalid channel: ${channel}`);
    return;
  }
  for (const listener of getRegisteredOnListeners(channel)) {
    try {
      listener(conn.fakeEvent(), ...args);
    } catch (error) {
      logger.error(`Listener for "${channel}" threw:`, error);
    }
  }
}

function onSocketMessage(conn: PhoneConnection, ws: WebSocket, raw: RawData) {
  let msg: any;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (msg?.type === "invoke" || msg?.type === "invokeEnvelope") {
    void handleInvoke(
      conn,
      msg.channel,
      Array.isArray(msg.args) ? msg.args : [],
      msg.type === "invokeEnvelope",
    ).then((response) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({ type: "invoke-result", id: msg.id, ...response }),
      );
    });
  } else if (msg?.type === "send") {
    handleSend(conn, msg.channel, Array.isArray(msg.args) ? msg.args : []);
  }
}
// ---------------------------------------------------------------------------
// Phone-side shim: reimplements window.electron over the WebSocket above,
// loaded in place of the real preload script (which only works inside
// Electron's contextBridge) when the page is opened in a normal browser tab.
// Plain ES5-ish JS -- no build step, has to run as-is in any phone browser.
// ---------------------------------------------------------------------------
// Exported so tests can check the address rewriting.
export const PHONE_SHIM_SCRIPT = `(function () {

  // Insecure (plain-http, non-localhost) contexts don't expose
  // crypto.randomUUID -- it's spec-restricted to secure contexts. The phone
  // bridge is deliberately plain HTTP for Milestone 1 (LAN-only, no login
  // yet), so polyfill just this one method using crypto.getRandomValues,
  // which IS available in insecure contexts. RFC 4122 v4 UUID.
  if (
    typeof crypto !== "undefined" &&
    crypto &&
    typeof crypto.randomUUID !== "function" &&
    typeof crypto.getRandomValues === "function"
  ) {
    crypto.randomUUID = function () {
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      var hex = [];
      for (var i = 0; i < 256; i++) {
        hex.push((i + 0x100).toString(16).slice(1));
      }
      var parts = [];
      for (var j = 0; j < 16; j++) {
        parts.push(hex[bytes[j]]);
      }
      return (
        parts[0] + parts[1] + parts[2] + parts[3] +
        "-" + parts[4] + parts[5] +
        "-" + parts[6] + parts[7] +
        "-" + parts[8] + parts[9] +
        "-" + parts[10] + parts[11] + parts[12] + parts[13] + parts[14] + parts[15]
      );
    };
  }
  var wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  var socket;
  var pending = new Map();
  var listeners = new Map();
  var nextId = 1;
  var queue = [];
  var filePickerActive = false;

  function rewritePreviewUrl(value) {
    if (typeof value !== "string") return value;
    var mediaPrefix = "dyad-media://media/";
    // Anywhere in the text, so pictures inside chat messages (markdown) work
    // as well as values that are a bare picture address.
    if (value.indexOf(mediaPrefix) !== -1) {
      return value.split(mediaPrefix).join(location.origin + "${PHONE_MEDIA_PATH_PREFIX}");
    }
    return value.replace(
      new RegExp("^http://(?:localhost|127[.]0[.]0[.]1):([0-9]{5})(?=/|$)"),
      function (match, port) {
        var numericPort = Number(port);
        if (numericPort < ${MIN_PREVIEW_PROXY_PORT} || numericPort > ${MAX_PREVIEW_PROXY_PORT}) {
          return match;
        }
        return location.protocol + "//" + location.hostname + ":" + port;
      }
    );
  }

  function rewritePreviewUrls(value) {
    if (typeof value === "string") return rewritePreviewUrl(value);
    if (Array.isArray(value)) return value.map(rewritePreviewUrls);
    if (value && typeof value === "object") {
      Object.keys(value).forEach(function (key) {
        value[key] = rewritePreviewUrls(value[key]);
      });
    }
    return value;
  }

  function rawSend(msg) {
    var json = JSON.stringify(msg);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(json);
    } else {
      queue.push(json);
    }
  }

  function connectSocket() {
    socket = new WebSocket(wsProtocol + "//" + location.host + "${WS_PATH}");
    socket.addEventListener("open", function () {
      queue.forEach(function (json) { socket.send(json); });
      queue.length = 0;
    });

    socket.addEventListener("message", function (evt) {
      var msg = rewritePreviewUrls(JSON.parse(evt.data));
      if (msg.type === "invoke-result") {
        var entry = pending.get(msg.id);
        if (!entry) return;
        pending.delete(msg.id);
        if (msg.ok) entry.resolve(msg.result);
        else entry.reject(new Error(msg.error));
      } else if (msg.type === "event") {
        var set = listeners.get(msg.channel);
        if (set) {
          Array.from(set).forEach(function (fn) {
            try { fn.apply(null, msg.args || []); } catch (e) { console.error(e); }
          });
        }
      }
    });

    socket.addEventListener("close", function () {
      console.warn("[phone bridge] connection to Crackerbox lost");
    });
  }

  connectSocket();

  // Mobile browsers freeze/kill the WebSocket whenever the tab is backgrounded.
  // Returning from a native file picker must reconnect in place so the chosen
  // File objects survive; ordinary stale sessions still reload and rehydrate.
  document.addEventListener("click", function (evt) {
    var target = evt.target;
    if (target && target.tagName === "INPUT" && target.type === "file") {
      filePickerActive = true;
    }
  }, true);
  function finishFilePickerSoon() {
    setTimeout(function () { filePickerActive = false; }, 5000);
  }
  document.addEventListener("change", function (evt) {
    var target = evt.target;
    if (target && target.tagName === "INPUT" && target.type === "file") {
      finishFilePickerSoon();
    }
  }, true);
  document.addEventListener("cancel", function (evt) {
    var target = evt.target;
    if (target && target.tagName === "INPUT" && target.type === "file") {
      finishFilePickerSoon();
    }
  }, true);

  function recoverIfDisconnected() {
    if (socket.readyState !== WebSocket.OPEN) {
      if (filePickerActive) {
        if (socket.readyState !== WebSocket.CONNECTING) connectSocket();
        return;
      }
      location.reload();
    }
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") recoverIfDisconnected();
  });
  window.addEventListener("pageshow", function (evt) {
    if (evt.persisted) recoverIfDisconnected();
  });
  window.addEventListener("focus", recoverIfDisconnected);

  function trimTrailingUndefined(arr) {
    // JSON can't represent undefined -- inside an array it silently becomes
    // null, unlike real Electron IPC (structured clone) which preserves
    // undefined faithfully. A wrapper calling invoke(channel, undefined) for
    // a no-arg (z.void()) contract would otherwise ship literal null over
    // the wire and fail validation. Trailing-undefined args are call-site
    // noise anyway (JS treats a missing arg the same as an explicit
    // undefined one), so drop them before they hit JSON.stringify.
    var i = arr.length;
    while (i > 0 && arr[i - 1] === undefined) i--;
    return arr.slice(0, i);
  }

  function doInvoke(type, channel, args) {
    var id = String(nextId++);
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
      rawSend({ type: type, id: id, channel: channel, args: trimTrailingUndefined(args) });
    });
  }

  window.electron = {
    ipcRenderer: {
      invoke: function (channel) {
        return doInvoke("invoke", channel, Array.prototype.slice.call(arguments, 1));
      },
      invokeEnvelope: function (channel) {
        return doInvoke("invokeEnvelope", channel, Array.prototype.slice.call(arguments, 1));
      },
      send: function (channel) {
        rawSend({ type: "send", channel: channel, args: Array.prototype.slice.call(arguments, 1) });
      },
      on: function (channel, listener) {
        if (!listeners.has(channel)) listeners.set(channel, new Set());
        listeners.get(channel).add(listener);
        return function () {
          var set = listeners.get(channel);
          if (set) set.delete(listener);
        };
      },
      removeAllListeners: function (channel) {
        listeners.delete(channel);
      },
      removeListener: function (channel, listener) {
        var set = listeners.get(channel);
        if (set) set.delete(listener);
      },
    },
    webFrame: {
      setZoomFactor: function () {},
      getZoomFactor: function () { return 1; },
    },
  };
})();
`;

function injectShimIntoHtml(html: string): string {
  const tag = `<script src="${SHIM_SRC}"></script>`;
  if (html.includes("<head>")) {
    return html.replace("<head>", `<head>\n    ${tag}`);
  }
  return tag + html;
}
const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serveStaticProd(
  rendererRoot: string,
  res: http.ServerResponse,
  pathname: string,
) {
  const relative =
    pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  let filePath = path.join(rendererRoot, relative);
  // SPA fallback: anything without a file extension is a client route.
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(rendererRoot, "index.html");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const contentType = STATIC_CONTENT_TYPES[ext] ?? "application/octet-stream";
    if (ext === ".html") {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(injectShimIntoHtml(data.toString("utf-8")));
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function proxyToDevServer(
  devServerUrl: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const target = new URL(devServerUrl);
  const proxyReq = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    },
    (proxyRes) => {
      const contentType = proxyRes.headers["content-type"] ?? "";
      if (contentType.includes("text/html")) {
        const chunks: Buffer[] = [];
        proxyRes.on("data", (chunk) => chunks.push(chunk));
        proxyRes.on("end", () => {
          const html = injectShimIntoHtml(
            Buffer.concat(chunks).toString("utf-8"),
          );
          const headers = { ...proxyRes.headers };
          delete headers["content-length"];
          headers["content-length"] = Buffer.byteLength(html).toString();
          res.writeHead(proxyRes.statusCode ?? 200, headers);
          res.end(html);
        });
        return;
      }
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (error) => {
    logger.error("Dev server proxy error:", error);
    if (!res.headersSent) res.writeHead(502);
    res.end("Phone bridge could not reach the Vite dev server");
  });
  req.pipe(proxyReq);
}

function proxyPhonePreview(
  port: number,
  upstreamPath: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const prefix = `${PREVIEW_PATH_PREFIX}${port}/`;
  const rewriteModuleImports = (source: string) =>
    source.replace(
      /(\b(?:from|import)\s*(?:\(\s*)?["'])\/(?!\/|__phone_preview\/)/g,
      `$1${prefix}`,
    );
  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port,
      path: upstreamPath,
      method: req.method,
      insecureHTTPParser: true,
      headers: {
        ...req.headers,
        host: `localhost:${port}`,
        "accept-encoding": "identity",
      },
    },
    (proxyRes) => {
      const contentType = proxyRes.headers["content-type"] ?? "";
      if (contentType.includes("text/html")) {
        const chunks: Buffer[] = [];
        proxyRes.on("data", (chunk) => chunks.push(chunk));
        proxyRes.on("end", () => {
          let html = Buffer.concat(chunks).toString("utf-8");
          html = html.replace(
            /\b(src|href|action)=(['"])\/(?!\/)/gi,
            `$1=$2${prefix}`,
          );
          html = rewriteModuleImports(html);
          const appRoute = new URL(upstreamPath, `http://localhost:${port}`);
          const previewRouteShim = `<script>
(() => {
  addEventListener("error", (event) => {
    console.error("[Crackerbox phone preview]", event.message, event.filename);
  });
  addEventListener("unhandledrejection", (event) => {
    console.error("[Crackerbox phone preview]", event.reason);
  });
  const bridgeUrl = location.pathname + location.search + location.hash;
  history.replaceState(history.state, "", ${JSON.stringify(
    appRoute.pathname + appRoute.search + appRoute.hash,
  )});
  addEventListener("load", () => {
    history.replaceState(history.state, "", bridgeUrl);
  }, { once: true });
})();
</script>`;
          const previewWebSocketShim = `<script>
(() => {
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      const resolved = new URL(String(url), location.href);
      if (resolved.host === location.host && !resolved.pathname.startsWith(${JSON.stringify(prefix)})) {
        resolved.pathname = ${JSON.stringify(prefix)} + resolved.pathname.replace(/^\\//, "");
      }
      super(resolved.toString(), protocols);
    }
  };
})();
</script>`;
          const base = `<base href="${prefix}">`;
          html = html.includes("<head>")
            ? html.replace(
                "<head>",
                `<head>\n    ${base}\n    ${previewRouteShim}\n    ${previewWebSocketShim}`,
              )
            : base + previewRouteShim + previewWebSocketShim + html;
          const headers = { ...proxyRes.headers };
          delete headers["content-length"];
          delete headers["content-encoding"];
          delete headers["transfer-encoding"];
          headers["content-length"] = Buffer.byteLength(html).toString();
          headers["cache-control"] = "no-store";
          res.writeHead(proxyRes.statusCode ?? 200, headers);
          res.end(html);
        });
        return;
      }
      if (
        contentType.includes("javascript") ||
        contentType.includes("ecmascript")
      ) {
        const chunks: Buffer[] = [];
        proxyRes.on("data", (chunk) => chunks.push(chunk));
        proxyRes.on("end", () => {
          const script = rewriteModuleImports(
            Buffer.concat(chunks).toString("utf-8"),
          );
          const headers = { ...proxyRes.headers };
          delete headers["content-length"];
          delete headers["content-encoding"];
          delete headers["transfer-encoding"];
          headers["content-length"] = Buffer.byteLength(script).toString();
          headers["cache-control"] = "no-store";
          res.writeHead(proxyRes.statusCode ?? 200, headers);
          res.end(script);
        });
        return;
      }
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", (error) => {
    logger.error("Phone preview proxy error:", error);
    if (!res.headersSent) res.writeHead(502);
    res.end("Crackerbox could not reach this app preview");
  });
  req.pipe(proxyReq);
}

function proxyPhonePreviewWebSocket(
  port: number,
  upstreamPath: string,
  req: http.IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer,
) {
  const proxyReq = http.request({
    hostname: "127.0.0.1",
    port,
    path: upstreamPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: `localhost:${port}`,
    },
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    let responseHead = `HTTP/1.1 ${proxyRes.statusCode ?? 101} ${proxyRes.statusMessage ?? "Switching Protocols"}\r\n`;
    for (const [name, value] of Object.entries(proxyRes.headers)) {
      if (value !== undefined) responseHead += `${name}: ${value}\r\n`;
    }
    socket.write(responseHead + "\r\n");
    if (head.length > 0) proxySocket.write(head);
    if (proxyHead.length > 0) socket.write(proxyHead);
    proxySocket.pipe(socket).pipe(proxySocket);
  });
  proxyReq.on("response", () => socket.destroy());
  proxyReq.on("error", (error) => {
    logger.warn("Phone preview WebSocket proxy error:", error);
    socket.destroy();
  });
  proxyReq.end();
}

function getLanUrls(port: number): string[] {
  const urls: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        urls.push(`http://${addr.address}:${port}`);
      }
    }
  }
  return urls;
}
export function startPhoneBridgeServer(devServerUrl: string | undefined) {
  const rendererRoot = path.join(__dirname, "../renderer/main_window");

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://internal");
    const pathname = requestUrl.pathname;

    if (pathname === SHIM_PATH) {
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(PHONE_SHIM_SCRIPT);
      return;
    }

    if (pathname.startsWith(PHONE_MEDIA_PATH_PREFIX)) {
      void servePhoneMedia(req, res, pathname, requestUrl.search);
      return;
    }

    if (pathname.startsWith(PREVIEW_PATH_PREFIX)) {
      const remainder = pathname.slice(PREVIEW_PATH_PREFIX.length);
      const separator = remainder.indexOf("/");
      const rawPort =
        separator === -1 ? remainder : remainder.slice(0, separator);
      const port = Number(rawPort);
      if (
        !Number.isInteger(port) ||
        port < MIN_PREVIEW_PROXY_PORT ||
        port > MAX_PREVIEW_PROXY_PORT
      ) {
        res.writeHead(404);
        res.end("Unknown preview");
        return;
      }
      const upstreamPath =
        (separator === -1 ? "/" : remainder.slice(separator)) +
        requestUrl.search;
      proxyPhonePreview(port, upstreamPath, req, res);
      return;
    }

    if (devServerUrl) {
      proxyToDevServer(devServerUrl, req, res);
      return;
    }

    serveStaticProd(rendererRoot, res, pathname);
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const requestUrl = new URL(req.url ?? "/", "http://internal");
    const pathname = requestUrl.pathname;
    if (pathname.startsWith(PREVIEW_PATH_PREFIX)) {
      const remainder = pathname.slice(PREVIEW_PATH_PREFIX.length);
      const separator = remainder.indexOf("/");
      const port = Number(
        separator === -1 ? remainder : remainder.slice(0, separator),
      );
      if (
        Number.isInteger(port) &&
        port >= MIN_PREVIEW_PROXY_PORT &&
        port <= MAX_PREVIEW_PROXY_PORT
      ) {
        const upstreamPath =
          (separator === -1 ? "/" : remainder.slice(separator)) +
          requestUrl.search;
        proxyPhonePreviewWebSocket(port, upstreamPath, req, socket, head);
        return;
      }
    }
    if (pathname !== WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    const conn = new PhoneConnection(ws);
    logger.info("Phone client connected");
    ws.on("message", (raw) => onSocketMessage(conn, ws, raw));
    ws.on("close", () => {
      logger.info("Phone client disconnected");
      conn.notifyClosed();
    });
    ws.on("error", (error) => logger.warn("Phone WebSocket error:", error));
  });

  server.listen(PHONE_BRIDGE_PORT, "0.0.0.0", () => {
    const urls = getLanUrls(PHONE_BRIDGE_PORT);
    logger.info(
      `Phone bridge listening on port ${PHONE_BRIDGE_PORT} (LAN only, no login yet). Try on your phone: ${
        urls.length
          ? urls.join(", ")
          : `http://<this computer's LAN IP>:${PHONE_BRIDGE_PORT}`
      }`,
    );
  });

  app.on("before-quit", () => {
    wss.close();
    server.close();
  });

  return server;
}
