// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({ userData: "" }));
vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => h.userData,
  getDyadAppPath: (p: string) => p,
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
}));

import {
  listMail,
  sendMail,
  writeRoster,
} from "@/pro/main/ipc/handlers/local_agent/house";
import { selectDelivered, startMailWake } from "./house_mail_wake";

const ROSTER = [
  { id: "nyx", name: "Nyx", appId: 47, color: "#eef0f4", initial: "N" },
  { id: "dextra", name: "Dextra", appId: 58, color: "#f59e0b", initial: "D" },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-20T10:00:00"));
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), "cb-wake-"));
  writeRoster(ROSTER);
  for (const id of ["nyx", "dextra"]) {
    fs.mkdirSync(path.join(h.userData, "house", "mailbox", id, "read"), {
      recursive: true,
    });
  }
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(h.userData, { recursive: true, force: true });
});

/** Starts the waker, lets its first (baseline) check pass, then returns it. */
function start(send: (p: { prompt: string }) => boolean) {
  const stop = startMailWake(send as never);
  vi.advanceTimersByTime(21_000);
  return stop;
}

describe("selectDelivered", () => {
  it("delivers short letters, oldest first, and leaves long ones in the inbox", () => {
    const long = "x".repeat(4000);
    expect(
      selectDelivered([
        { fromName: "Nyx", subject: "a", body: "short" },
        { fromName: "Nyx", subject: "b", body: long },
        { fromName: "Nyx", subject: "c", body: "also short" },
        { fromName: "Nyx", subject: "d" },
      ]),
    ).toEqual([true, false, true, false]);
  });

  it("stops at eight letters and at a total size", () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({
      fromName: "Nyx",
      subject: `n${i}`,
      body: "y".repeat(100),
    }));
    expect(selectDelivered(eleven).filter(Boolean)).toHaveLength(8);

    const big = Array.from({ length: 6 }, (_, i) => ({
      fromName: "Nyx",
      subject: `n${i}`,
      body: "z".repeat(2900),
    }));
    // 4 x 2,900 = 11,600 fits under 14,000; a fifth would not.
    expect(selectDelivered(big).filter(Boolean)).toHaveLength(4);
  });
});

describe("wake delivers the letters themselves", () => {
  it("puts every waiting letter's text in the wake and marks them read", () => {
    const sent: string[] = [];
    const stop = start((p) => {
      sent.push(p.prompt);
      return true;
    });

    sendMail("Nyx", "dextra", "First note", "Her framing is kept exactly.");
    vi.advanceTimersByTime(1_000);
    sendMail("Nyx", "dextra", "Second note", "The front door is open to you.");
    vi.advanceTimersByTime(61_000);
    stop();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("2 letters have arrived for you");
    expect(sent[0]).toContain("Her framing is kept exactly.");
    expect(sent[0]).toContain("The front door is open to you.");
    expect(sent[0]).toContain('subject "First note"');
    // Delivered, so nothing is left unread to pile up.
    expect(listMail("dextra").filter((m) => m.unread)).toEqual([]);
  });

  it("leaves the letters unread when the window cannot take the wake yet", () => {
    const stop = start(() => false);

    sendMail("Nyx", "dextra", "Hello", "Are you there?");
    vi.advanceTimersByTime(61_000);
    stop();

    expect(listMail("dextra").filter((m) => m.unread)).toHaveLength(1);
  });

  it("keeps a very long letter in the inbox and names it", () => {
    const sent: string[] = [];
    const stop = start((p) => {
      sent.push(p.prompt);
      return true;
    });

    sendMail("Nyx", "dextra", "Short", "Just this.");
    vi.advanceTimersByTime(1_000);
    sendMail("Nyx", "dextra", "Very long", "w".repeat(5000));
    vi.advanceTimersByTime(61_000);
    stop();

    expect(sent[0]).toContain("Just this.");
    expect(sent[0]).not.toContain("w".repeat(100));
    expect(sent[0]).toContain("Still waiting in your inbox");
    expect(sent[0]).toContain('"Very long"');
    const unread = listMail("dextra").filter((m) => m.unread);
    expect(unread.map((m) => m.subject)).toEqual(["Very long"]);
  });
});
