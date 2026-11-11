import { describe, expect, it, vi } from "vitest";

vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => "",
  getDyadAppPath: (p: string) => p,
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info() {}, warn() {}, error() {} }) },
}));

import {
  buildTelegramPrompt,
  parseEnvCreds,
  parseUpdate,
} from "./telegram_inbound";

describe("parseEnvCreds", () => {
  it("reads token and chat, ignoring comments and quotes", () => {
    const env = '# note\nTELEGRAM_BOT_TOKEN="abc:123"\nTELEGRAM_CHAT_ID=777\n';
    expect(parseEnvCreds(env)).toEqual({ token: "abc:123", chat: "777" });
  });
  it("returns blanks when missing", () => {
    expect(parseEnvCreds("X=1")).toEqual({ token: "", chat: "" });
  });
});

describe("parseUpdate", () => {
  const now = 1_000_000;
  const upd = (over: any = {}) => ({
    update_id: 5,
    message: { chat: { id: 777 }, date: now - 10, text: "hi", ...over },
  });
  it("accepts text from the allowed chat", () => {
    const m = parseUpdate(upd(), "777", now);
    expect(m).toMatchObject({ updateId: 5, text: "hi", kind: "text", ageSeconds: 10 });
  });
  it("rejects other chats", () => {
    expect(parseUpdate(upd({ chat: { id: 1 } }), "777", now)).toBeNull();
  });
  it("flags photos and other media", () => {
    expect(parseUpdate(upd({ text: undefined, photo: [{}], caption: "look" }), "777", now)).toMatchObject({ kind: "photo", text: "look" });
    expect(parseUpdate(upd({ text: undefined, voice: {} }), "777", now)?.kind).toBe("other");
  });
  it("ignores non-message updates", () => {
    expect(parseUpdate({ update_id: 1, edited_message: {} }, "777", now)).toBeNull();
  });
});

describe("buildTelegramPrompt", () => {
  it("tells her to answer through the Telegram tool as herself", () => {
    const p = buildTelegramPrompt("Nyx", { updateId: 1, text: "morning", kind: "text", ageSeconds: 0 });
    expect(p).toContain("morning");
    expect(p).toContain('as="nyx"');
  });
});