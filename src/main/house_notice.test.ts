// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({ base: "", roster: [] as { id: string }[] }));
vi.mock("@/paths/paths", () => ({
  getDyadAppPath: (id: string) => path.join(h.base, id),
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info() {}, warn() {}, error() {} }) },
}));
vi.mock("@/pro/main/ipc/handlers/local_agent/house", () => ({
  readRoster: () => h.roster,
}));

import {
  noticeOncePerDay,
  resetNoticesForTests,
  sendTelegramNotice,
  type TelegramFetch,
} from "./house_notice";

function bot(id: string, token: string) {
  fs.mkdirSync(path.join(h.base, id), { recursive: true });
  fs.writeFileSync(
    path.join(h.base, id, ".env"),
    `TELEGRAM_BOT_TOKEN=${token}\nTELEGRAM_CHAT_ID=42\n`,
  );
}

beforeEach(() => {
  h.base = fs.mkdtempSync(path.join(os.tmpdir(), "cb-notice-"));
  h.roster = [{ id: "dextra" }, { id: "nyx" }];
  resetNoticesForTests();
});
afterEach(() => fs.rmSync(h.base, { recursive: true, force: true }));

describe("sendTelegramNotice", () => {
  it("sends from the first bot that Telegram accepts", async () => {
    bot("dextra", "aaa");
    const send = vi.fn<TelegramFetch>(async () => ({ ok: true, status: 200 }));
    expect(await sendTelegramNotice("hi", send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toContain("botaaa/sendMessage");
  });

  it("counts a turned-down message as not sent and tries the next bot", async () => {
    bot("dextra", "dead");
    bot("nyx", "good");
    const send = vi.fn<TelegramFetch>(async (url) =>
      url.includes("botdead")
        ? { ok: false, status: 401 }
        : { ok: true, status: 200 },
    );
    expect(await sendTelegramNotice("hi", send)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("reports failure when every bot fails, errors or has no bot at all", async () => {
    bot("dextra", "a");
    const boom = vi.fn<TelegramFetch>(async () => {
      throw new Error("network down");
    });
    expect(await sendTelegramNotice("hi", boom)).toBe(false);
    fs.rmSync(path.join(h.base, "dextra"), { recursive: true });
    expect(await sendTelegramNotice("hi", boom)).toBe(false);
  });
});

describe("noticeOncePerDay", () => {
  it("says a repeating problem once a day, and retries if the note did not go out", async () => {
    bot("dextra", "a");
    const day = new Date(2026, 10, 18, 9);
    const fail = vi.fn<TelegramFetch>(async () => ({ ok: false, status: 500 }));
    const ok = vi.fn<TelegramFetch>(async () => ({ ok: true, status: 200 }));
    expect(await noticeOncePerDay("k", "x", day, fail)).toBe(false);
    expect(await noticeOncePerDay("k", "x", day, ok)).toBe(true); // retried
    expect(await noticeOncePerDay("k", "x", day, ok)).toBe(false); // already said today
    expect(ok).toHaveBeenCalledTimes(1);
    const nextDay = new Date(2026, 10, 19, 9);
    expect(await noticeOncePerDay("k", "x", nextDay, ok)).toBe(true);
  });
});
