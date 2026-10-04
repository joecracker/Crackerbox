// Phone access: serves Crackerbox's app pictures and chat images to a phone
// browser. Inside the desktop window those use the dyad-media:// protocol,
// which a phone browser cannot open. This route hands the same request to the
// same dyad-media handler (so it keeps the same path-containment checks) and
// returns the answer over plain HTTP.
import type * as http from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import log from "electron-log";

const logger = log.scope("phone_bridge_media");

export const PHONE_MEDIA_PATH_PREFIX = "/__phone_bridge/media/";

export type PhoneMediaHandler = (
  request: Request,
) => Promise<Response> | Response;

let mediaHandler: PhoneMediaHandler | null = null;

/** Called once at startup with the same handler the desktop window uses. */
export function setPhoneMediaHandler(handler: PhoneMediaHandler | null): void {
  mediaHandler = handler;
}

/**
 * Turns /__phone_bridge/media/<rest> into dyad-media://media/<rest>.
 * Returns null for anything that is not a media request or tries to climb
 * out of a folder.
 */
export function buildDyadMediaUrlFromPhonePath(
  pathname: string,
  search: string,
): string | null {
  if (!pathname.startsWith(PHONE_MEDIA_PATH_PREFIX)) return null;
  const rest = pathname.slice(PHONE_MEDIA_PATH_PREFIX.length);
  if (!rest) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  if (decoded.split(/[\\/]/).some((segment) => segment === "..")) return null;
  return `dyad-media://media/${rest}${search}`;
}

export async function servePhoneMedia(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  search: string,
): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  const handler = mediaHandler;
  if (!handler) {
    res.writeHead(503);
    res.end("Media is not ready yet");
    return;
  }
  const mediaUrl = buildDyadMediaUrlFromPhonePath(pathname, search);
  if (!mediaUrl) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  try {
    const response = await handler(new Request(mediaUrl, { method: "GET" }));
    const headers: Record<string, string> = {
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
      // Pictures only: stops scripts inside a hostile SVG or HTML file.
      "Content-Security-Policy":
        "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
    };
    const contentType = response.headers.get("content-type");
    if (contentType) headers["Content-Type"] = contentType;
    const contentLength = response.headers.get("content-length");
    if (contentLength) headers["Content-Length"] = contentLength;
    res.writeHead(response.status, headers);
    if (req.method === "HEAD" || !response.body) {
      res.end();
      return;
    }
    const stream = Readable.fromWeb(response.body as NodeWebReadableStream);
    stream.on("error", (error) => {
      logger.warn("Media stream failed", error);
      res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    logger.warn("Phone media request failed", error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}
