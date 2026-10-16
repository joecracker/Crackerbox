// Lets Chrome on a phone offer a real "Install app" (its own Crackerbox icon,
// opens without the browser bar) for the page the phone bridge serves, instead
// of only a plain web-page shortcut. Chrome needs three things for that: an
// install file (the manifest), icons, and a helper script with a fetch handler.
import type * as http from "node:http";
import {
  PHONE_ICON_192_BASE64,
  PHONE_ICON_512_BASE64,
} from "./phone_bridge_icons";

export const PHONE_MANIFEST_PATH = "/manifest.webmanifest";
export const PHONE_SERVICE_WORKER_PATH = "/crackerbox-sw.js";
export const PHONE_ICON_192_PATH = "/__phone_bridge/icon-192.png";
export const PHONE_ICON_512_PATH = "/__phone_bridge/icon-512.png";

const THEME_COLOR = "#1e231d";

export const PHONE_MANIFEST = {
  id: "/",
  name: "Crackerbox",
  short_name: "Crackerbox",
  description: "Chat with Crackerbox from your phone.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: THEME_COLOR,
  theme_color: THEME_COLOR,
  icons: [
    {
      src: PHONE_ICON_192_PATH,
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: PHONE_ICON_512_PATH,
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
  ],
};

// Chrome only treats a page as installable when it has a helper script with a
// fetch handler. This one does nothing to requests: every one still goes
// straight to the network, so the live connection and previews are untouched.
export const PHONE_SERVICE_WORKER_SCRIPT = [
  'self.addEventListener("install", function () { self.skipWaiting(); });',
  'self.addEventListener("activate", function (event) { event.waitUntil(self.clients.claim()); });',
  'self.addEventListener("fetch", function () {});',
  "",
].join("\n");

// Goes into the <head> of the page the phone loads.
// The manifest link must say use-credentials: this page sits behind the
// Cloudflare sign-in, and without it Chrome asks for the install file with no
// cookies, gets sent to the sign-in page instead, and never offers "Install app".
export const PHONE_INSTALL_HEAD_TAGS = [
  '<link rel="manifest" href="' +
    PHONE_MANIFEST_PATH +
    '" crossorigin="use-credentials">',
  '<meta name="theme-color" content="' + THEME_COLOR + '">',
  '<link rel="icon" type="image/png" href="' + PHONE_ICON_192_PATH + '">',
  '<link rel="apple-touch-icon" href="' + PHONE_ICON_192_PATH + '">',
  '<script>if ("serviceWorker" in navigator) { window.addEventListener("load", function () { navigator.serviceWorker.register("' +
    PHONE_SERVICE_WORKER_PATH +
    '").catch(function () {}); }); }</script>',
].join("\n    ");

const ICON_192 = Buffer.from(PHONE_ICON_192_BASE64, "base64");
const ICON_512 = Buffer.from(PHONE_ICON_512_BASE64, "base64");

/** Answers the install files. Returns false when the path is not one of them. */
export function servePhoneInstallAsset(
  pathname: string,
  res: http.ServerResponse,
): boolean {
  if (pathname === PHONE_MANIFEST_PATH) {
    res.writeHead(200, {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(JSON.stringify(PHONE_MANIFEST));
    return true;
  }
  if (pathname === PHONE_SERVICE_WORKER_PATH) {
    res.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    });
    res.end(PHONE_SERVICE_WORKER_SCRIPT);
    return true;
  }
  if (pathname === PHONE_ICON_192_PATH || pathname === PHONE_ICON_512_PATH) {
    const body = pathname === PHONE_ICON_192_PATH ? ICON_192 : ICON_512;
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
      "Content-Length": String(body.length),
    });
    res.end(body);
    return true;
  }
  return false;
}
