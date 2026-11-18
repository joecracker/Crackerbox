// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({ userData: "" }));
vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => h.userData,
}));

import {
  PHONE_KEY_COOKIE,
  clearPhoneRefusalForTests,
  decidePhoneAccess,
  getLastPhoneRefusal,
  getPhoneAccessKey,
  isSecureRequest,
  phoneKeyCookie,
  phoneRefusalMessage,
  readCookie,
  recordPhoneRefusal,
  resetPhoneAccessKey,
  withoutPhoneKeyCookie,
} from "./phone_bridge_auth";

beforeEach(() => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), "cb-phone-key-"));
  clearPhoneRefusalForTests();
});
afterEach(() => {
  fs.rmSync(h.userData, { recursive: true, force: true });
});

describe("the phone access key", () => {
  it("is long, random, made once and kept across restarts", () => {
    const first = getPhoneAccessKey();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    clearPhoneRefusalForTests(); // forgets the in-memory copy, like a restart
    expect(getPhoneAccessKey()).toBe(first);
    expect(
      fs.readFileSync(path.join(h.userData, "phone-access-key.txt"), "utf8"),
    ).toContain(first);
  });

  it("is replaced on reset, and the old one stops working", () => {
    const old = getPhoneAccessKey();
    const fresh = resetPhoneAccessKey();
    expect(fresh).not.toBe(old);
    expect(getPhoneAccessKey()).toBe(fresh);
    const cookie = `${PHONE_KEY_COOKIE}=${old}`;
    expect(decidePhoneAccess("/", cookie, fresh, false)).toEqual({
      kind: "deny",
      reason: "wrong-key",
    });
  });

  it("is made again when the saved file is damaged", () => {
    fs.writeFileSync(path.join(h.userData, "phone-access-key.txt"), "short");
    expect(getPhoneAccessKey()).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });
});

describe("deciding who gets in", () => {
  const key = "k".repeat(43);

  it("turns away a request with no key at all", () => {
    expect(decidePhoneAccess("/", undefined, key, false)).toEqual({
      kind: "deny",
      reason: "no-key",
    });
    expect(decidePhoneAccess("/", "other=1", key, false)).toEqual({
      kind: "deny",
      reason: "no-key",
    });
  });

  it("turns away a wrong key, in the address or in the cookie", () => {
    expect(decidePhoneAccess("/?cbkey=nope", undefined, key, false)).toEqual({
      kind: "deny",
      reason: "wrong-key",
    });
    expect(
      decidePhoneAccess("/", `${PHONE_KEY_COOKIE}=nope`, key, false),
    ).toEqual({ kind: "deny", reason: "wrong-key" });
    // same length, one character off
    expect(
      decidePhoneAccess(
        "/",
        `${PHONE_KEY_COOKIE}=${"k".repeat(42)}x`,
        key,
        false,
      ),
    ).toEqual({ kind: "deny", reason: "wrong-key" });
  });

  it("lets a phone in with the cookie", () => {
    expect(
      decidePhoneAccess(
        "/chat",
        `a=1; ${PHONE_KEY_COOKIE}=${key}; b=2`,
        key,
        false,
      ),
    ).toEqual({ kind: "allow" });
  });

  it("pairs from the QR address: sets the cookie and cleans the address", () => {
    const decision = decidePhoneAccess(
      `/?cbpair=1&cbkey=${key}`,
      undefined,
      key,
      false,
    );
    expect(decision).toMatchObject({ kind: "pair", location: "/?cbpair=1" });
    if (decision.kind !== "pair") throw new Error("expected pair");
    expect(decision.setCookie).toContain(`${PHONE_KEY_COOKIE}=${key}`);
    expect(decision.setCookie).toContain("HttpOnly");
    expect(decision.setCookie).toContain("Max-Age=31536000");
    expect(decision.setCookie).not.toContain("Secure");
  });

  it("marks the cookie Secure when it came over https", () => {
    expect(phoneKeyCookie(key, true)).toContain("; Secure");
    expect(isSecureRequest({ "x-forwarded-proto": "https" })).toBe(true);
    expect(isSecureRequest({ "cf-visitor": '{"scheme":"https"}' })).toBe(true);
    expect(isSecureRequest({})).toBe(false);
  });
});

describe("cookies", () => {
  it("reads one cookie by exact name", () => {
    expect(readCookie("a=1; cb_phone_key=abc; b=2", "cb_phone_key")).toBe(
      "abc",
    );
    expect(readCookie("xcb_phone_key=abc", "cb_phone_key")).toBeNull();
    expect(readCookie(undefined, "cb_phone_key")).toBeNull();
  });

  it("keeps the phone key away from preview apps", () => {
    expect(
      withoutPhoneKeyCookie({
        cookie: `a=1; ${PHONE_KEY_COOKIE}=abc; b=2`,
        host: "x",
      }),
    ).toEqual({ cookie: "a=1; b=2", host: "x" });
    expect(
      withoutPhoneKeyCookie({ cookie: `${PHONE_KEY_COOKIE}=abc` }),
    ).toEqual({});
  });
});

describe("telling someone what went wrong", () => {
  it("remembers the last device turned away", () => {
    expect(getLastPhoneRefusal()).toBeNull();
    recordPhoneRefusal("192.168.1.40", "no-key", 1000);
    expect(getLastPhoneRefusal()).toEqual({
      at: 1000,
      address: "192.168.1.40",
      reason: "no-key",
    });
  });

  it("has a plain instruction for every reason", () => {
    for (const reason of ["no-key", "wrong-key", "no-key-file"] as const) {
      expect(phoneRefusalMessage(reason)).toContain("Crackerbox");
    }
    expect(phoneRefusalMessage("wrong-key")).toContain("Add a phone");
  });
});
