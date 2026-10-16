// Previews for a phone that comes in through Cloudflare.
//
// Through Cloudflare only a few ordinary web ports reach this computer, and a
// preview must NOT share Crackerbox's own address (the preview app's "/" would
// then be Crackerbox itself, and the two end up inside each other). So the
// preview is served on the same host name but a second ordinary port. A
// different port is a different address to the browser (its own pages, its own
// storage), yet cookies ignore ports, so the Cloudflare sign-in already done on
// the main address covers it with no second sign-in.
//
// Which preview to show travels in a cookie, because the preview app asks for
// plenty of addresses of its own (scripts, pictures, calls home).
import type * as http from "node:http";

export const PREVIEW_PUBLIC_PORT = 8443;
export const PREVIEW_SELECT_PARAM = "cbp";
export const PREVIEW_COOKIE = "cb_preview";

/** The port the browser asked for (the number after the colon in Host), if any. */
export function hostPort(hostHeader: string | undefined): number | null {
  if (typeof hostHeader !== "string") return null;
  const match = hostHeader.trim().match(/:(\d{1,5})$/);
  return match ? Number(match[1]) : null;
}

export function isPreviewHost(hostHeader: string | undefined): boolean {
  return hostPort(hostHeader) === PREVIEW_PUBLIC_PORT;
}

/** The host name without any port, e.g. "remote.crackerbox.app". */
export function hostName(hostHeader: string | undefined): string | null {
  if (typeof hostHeader !== "string") return null;
  const name = hostHeader.trim().replace(/:\d{1,5}$/, "");
  return /^[a-z0-9.-]+$/i.test(name) ? name : null;
}

function validPort(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function readPreviewCookie(
  cookieHeader: string | undefined,
  min: number,
  max: number,
): number | null {
  if (typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === PREVIEW_COOKIE) {
      const port = Number(value);
      return validPort(port, min, max) ? port : null;
    }
  }
  return null;
}

/** Cookie header for the preview app: without Crackerbox's own sign-in cookies. */
export function cookiesForPreviewApp(
  cookieHeader: string | undefined,
): string | undefined {
  if (typeof cookieHeader !== "string") return undefined;
  const kept = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter((part) => {
      const name = part.split("=")[0].toLowerCase();
      return (
        part !== "" &&
        name !== PREVIEW_COOKIE &&
        name !== "cf_authorization" &&
        name !== "cf_appsession"
      );
    });
  return kept.length ? kept.join("; ") : undefined;
}

export type PreviewHostPlan =
  | { kind: "select"; port: number; location: string }
  | { kind: "proxy"; port: number; path: string }
  | { kind: "none" };

/**
 * Decides what to do with a request that arrived on the preview port: a first
 * request that names its preview (?cbp=PORT) remembers it and goes to the same
 * address without that marker; everything after uses the remembered one.
 */
export function planPreviewHostRequest(
  requestUrl: string,
  cookieHeader: string | undefined,
  min: number,
  max: number,
): PreviewHostPlan {
  const url = new URL(requestUrl, "http://internal");
  const asked = url.searchParams.get(PREVIEW_SELECT_PARAM);
  if (asked !== null) {
    const port = Number(asked);
    if (!validPort(port, min, max)) return { kind: "none" };
    url.searchParams.delete(PREVIEW_SELECT_PARAM);
    return {
      kind: "select",
      port,
      location: url.pathname + url.search + url.hash,
    };
  }
  const port = readPreviewCookie(cookieHeader, min, max);
  if (port === null) return { kind: "none" };
  return { kind: "proxy", port, path: url.pathname + url.search };
}

export function selectCookieHeader(port: number): string {
  return `${PREVIEW_COOKIE}=${port}; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax`;
}

/**
 * The preview's own policy only lets localhost-style pages frame it. The page
 * framing it here is Crackerbox on the same host name (ordinary port), so let
 * exactly that one address in.
 */
export function allowFramingBy(
  headers: http.IncomingHttpHeaders,
  parentOrigin: string,
): http.IncomingHttpHeaders {
  const out: http.IncomingHttpHeaders = { ...headers };
  for (const key of Object.keys(out)) {
    if (key.toLowerCase() !== "content-security-policy") continue;
    const value = out[key];
    const fix = (policy: string) =>
      policy.replace(
        /frame-ancestors\s+/i,
        (found) => found + parentOrigin + " ",
      );
    out[key] = Array.isArray(value)
      ? value.map(fix)
      : value
        ? fix(value)
        : value;
  }
  return out;
}
