// Phone access key. The phone server used to let anyone on the network in. Now
// every request must carry a long random key, which the phone gets once by
// scanning the QR code in Settings > Add a phone (the key rides in the QR
// address, the server swaps it for a long-lived cookie, and the address is
// cleaned). A phone without the key is turned away with a page that says how
// to fix it, and the last turned-away device is shown in Settings.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type * as http from "node:http";
import { getUserDataPath } from "@/paths/paths";

export const PHONE_KEY_PARAM = "cbkey";
export const PHONE_KEY_COOKIE = "cb_phone_key";
export const PHONE_AUTH_CHECK_PATH = "/__phone_bridge/auth-check";
const KEY_FILE = "phone-access-key.txt";
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

// ---------------------------------------------------------------- the key

let cache: { file: string; key: string } | null = null;

function keyFile(): string {
  return path.join(getUserDataPath(), KEY_FILE);
}

function makeKey(): string {
  const file = keyFile();
  const key = crypto.randomBytes(32).toString("base64url");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, key + "\n", { mode: 0o600 });
  cache = { file, key };
  return key;
}

/** The key phones must present. Made on first use and kept across restarts. */
export function getPhoneAccessKey(): string {
  const file = keyFile();
  if (cache && cache.file === file) return cache.key;
  try {
    const saved = fs.readFileSync(file, "utf8").trim();
    if (/^[A-Za-z0-9_-]{32,}$/.test(saved)) {
      cache = { file, key: saved };
      return saved;
    }
  } catch {
    // no key yet
  }
  return makeKey();
}

/** A new key: every phone paired before has to scan the QR code again. */
export function resetPhoneAccessKey(): string {
  return makeKey();
}

function sameKey(offered: string, key: string): boolean {
  const a = crypto.createHash("sha256").update(offered).digest();
  const b = crypto.createHash("sha256").update(key).digest();
  return crypto.timingSafeEqual(a, b);
}

// -------------------------------------------------------------- the check

export type RefusalReason = "no-key" | "wrong-key" | "no-key-file";

export type AccessDecision =
  | { kind: "allow" }
  | { kind: "pair"; setCookie: string; location: string }
  | { kind: "deny"; reason: RefusalReason };

export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (typeof cookieHeader !== "string") return null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0 && trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

export function phoneKeyCookie(key: string, secure: boolean): string {
  return (
    `${PHONE_KEY_COOKIE}=${key}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax` +
    (secure ? "; Secure" : "")
  );
}

/**
 * Decides what to do with one request. The key in the address (from the QR
 * code) starts a pairing; after that the cookie is enough. Anything else is
 * turned away.
 */
export function decidePhoneAccess(
  requestUrl: string | undefined,
  cookieHeader: string | undefined,
  key: string,
  secure: boolean,
): AccessDecision {
  const url = new URL(requestUrl ?? "/", "http://internal");
  const offered = url.searchParams.get(PHONE_KEY_PARAM);
  if (offered !== null) {
    if (!sameKey(offered, key)) return { kind: "deny", reason: "wrong-key" };
    url.searchParams.delete(PHONE_KEY_PARAM);
    return {
      kind: "pair",
      setCookie: phoneKeyCookie(key, secure),
      location: url.pathname + url.search,
    };
  }
  const cookie = readCookie(cookieHeader, PHONE_KEY_COOKIE);
  if (cookie === null) return { kind: "deny", reason: "no-key" };
  return sameKey(cookie, key)
    ? { kind: "allow" }
    : { kind: "deny", reason: "wrong-key" };
}

/** Came in over https (through the Cloudflare tunnel), so the cookie can say Secure. */
export function isSecureRequest(headers: http.IncomingHttpHeaders): boolean {
  const proto = headers["x-forwarded-proto"];
  if (typeof proto === "string" && proto.split(",")[0].trim() === "https") {
    return true;
  }
  const visitor = headers["cf-visitor"];
  return typeof visitor === "string" && visitor.includes('"https"');
}

/** The headers to hand to a preview app: it never sees the phone key. */
export function withoutPhoneKeyCookie(
  headers: http.IncomingHttpHeaders,
): http.IncomingHttpHeaders {
  const out = { ...headers };
  if (typeof out.cookie !== "string") return out;
  const kept = out.cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !part.startsWith(PHONE_KEY_COOKIE + "="));
  if (kept.length) out.cookie = kept.join("; ");
  else delete out.cookie;
  return out;
}

// ------------------------------------------------- what the phone is told

const MESSAGES: Record<RefusalReason, string> = {
  "no-key":
    "This phone has not been set up for Crackerbox yet. On your computer open Crackerbox, go to Settings > Add a phone, and scan the QR code with this phone's camera.",
  "wrong-key":
    "This phone's Crackerbox key is out of date, most likely because phone access was reset on the computer. On your computer open Crackerbox, go to Settings > Add a phone, and scan the QR code again.",
  "no-key-file":
    "Crackerbox could not read its phone key on the computer, so it is keeping phones out until that is fixed. Restart Crackerbox on the computer. If this keeps happening, look at Settings > Add a phone.",
};

export function phoneRefusalMessage(reason: RefusalReason): string {
  return MESSAGES[reason];
}

export function phoneRefusalPage(reason: RefusalReason): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Crackerbox</title></head>" +
    '<body style="font:17px/1.5 system-ui,sans-serif;max-width:30em;margin:3em auto;padding:0 1em">' +
    "<h2>Crackerbox says no</h2><p>" +
    MESSAGES[reason] +
    "</p></body></html>"
  );
}

// ----------------------------------- the last device that was turned away

export type PhoneRefusal = {
  at: number;
  address: string;
  reason: RefusalReason;
};

let lastRefusal: PhoneRefusal | null = null;

export function recordPhoneRefusal(
  address: string | undefined,
  reason: RefusalReason,
  now: number = Date.now(),
): PhoneRefusal {
  lastRefusal = { at: now, address: address ?? "unknown", reason };
  return lastRefusal;
}

export function getLastPhoneRefusal(): PhoneRefusal | null {
  return lastRefusal;
}

/** For tests: forget the last refusal and the remembered key. */
export function clearPhoneRefusalForTests() {
  lastRefusal = null;
  cache = null;
}
