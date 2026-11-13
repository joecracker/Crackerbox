import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({ userData: "", apps: "" }));
vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => h.userData,
  getDyadAppPath: (p: string) => path.join(h.apps, p),
}));

import {
  housePromptForSister,
  listMail,
  readMail,
  readRoster,
  writeRoster,
  sendMail,
  sisterForApp,
  writeShared,
  readShared,
  listShared,
} from "./house";

const TEST_ROSTER = [
  { id: "nyx", name: "Nyx", appId: 47, color: "#eef0f4", initial: "N" },
  { id: "veritas", name: "Veritas", appId: 57, color: "#0ea5e9", initial: "V" },
];

beforeEach(() => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), "cb-house-"));
  h.apps = fs.mkdtempSync(path.join(os.tmpdir(), "cb-apps-"));
  writeRoster(TEST_ROSTER);
  for (const id of ["nyx", "veritas", "tim"]) {
    fs.mkdirSync(path.join(h.userData, "house", "mailbox", id, "read"), {
      recursive: true,
    });
  }
  fs.mkdirSync(path.join(h.userData, "house", "shared"), { recursive: true });
});
afterEach(() => {
  fs.rmSync(h.userData, { recursive: true, force: true });
  fs.rmSync(h.apps, { recursive: true, force: true });
});

describe("house", () => {
  it("starts empty and finds a sister by app", () => {
    fs.rmSync(path.join(h.userData, "house"), { recursive: true, force: true });
    expect(readRoster()).toEqual([]);
    writeRoster(TEST_ROSTER);
    expect(readRoster().map((s) => s.id)).toEqual(["nyx", "veritas"]);
    expect(sisterForApp(57)?.name).toBe("Veritas");
    expect(sisterForApp(999)).toBeUndefined();
  });

  it("delivers a letter to one inbox, and reading it marks it read", () => {
    const f = sendMail("Nyx", "veritas", "Drawer war", "Round one is yours.");
    expect(listMail("veritas")[0]).toMatchObject({ from: "Nyx", unread: true });
    expect(listMail("nyx")).toEqual([]);
    expect(readMail("veritas", f)).toContain("Round one");
    expect(listMail("veritas")[0].unread).toBe(false);
  });

  it("refuses a letter to nobody", () => {
    expect(() => sendMail("Nyx", "ghost", "x", "y")).toThrow(/nobody/);
  });

  it("writes shared files with append and a size limit", () => {
    writeShared("household", "one", "replace");
    writeShared("household", "two", "append");
    expect(readShared("household")).toBe("one\ntwo\n");
    expect(() => writeShared("big", "x".repeat(9000), "replace")).toThrow();
    expect(listShared()).toEqual(["household.md"]);
  });

  it("builds the prompt block for a sister: her name, her housemates and unread letters", () => {
    const veritas = TEST_ROSTER[1];
    expect(housePromptForSister(veritas)).toContain("No unread letters.");

    sendMail("Nyx", "veritas", "hello", "hi");
    const block = housePromptForSister(veritas);
    expect(block).toContain("You are Veritas");
    expect(block).toContain("live in the house with Nyx");
    expect(block).toContain("1 unread letter (from Nyx)");
    expect(housePromptForSister(TEST_ROSTER[0])).toContain(
      "No unread letters.",
    );
  });
});
