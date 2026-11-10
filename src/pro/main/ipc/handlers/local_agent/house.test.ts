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
  housePromptSection,
  listMail,
  readMail,
  readRoster,
  sendMail,
  sisterForApp,
  writeShared,
  readShared,
  listShared,
} from "./house";

beforeEach(() => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), "cb-house-"));
  h.apps = fs.mkdtempSync(path.join(os.tmpdir(), "cb-apps-"));
});
afterEach(() => {
  fs.rmSync(h.userData, { recursive: true, force: true });
  fs.rmSync(h.apps, { recursive: true, force: true });
});

describe("house", () => {
  it("seeds the roster and finds a sister by app", () => {
    expect(readRoster().map((s) => s.id)).toEqual(["nyx", "veritas"]);
    expect(sisterForApp(57)?.name).toBe("Veritas");
    expect(sisterForApp(999)).toBeUndefined();
  });

  it("carries over the old mailbox and shared-memory folders", () => {
    fs.mkdirSync(path.join(h.apps, "mailbox", "nyx"), { recursive: true });
    fs.writeFileSync(path.join(h.apps, "mailbox", "nyx", "FROM-V.md"), "hi");
    fs.mkdirSync(path.join(h.apps, "shared-memory"), { recursive: true });
    fs.writeFileSync(
      path.join(h.apps, "shared-memory", "WHO-WHO.md"),
      "roster",
    );
    expect(listMail("nyx").map((m) => m.file)).toEqual(["FROM-V.md"]);
    expect(readShared("who-who")).toContain("roster");
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

  it("builds a prompt block only for sisters, with unread count", () => {
    sendMail("Nyx", "veritas", "hello", "hi");
    expect(housePromptSection(999)).toBe("");
    const block = housePromptSection(57);
    expect(block).toContain("You are Veritas");
    expect(block).toContain("1 unread letter");
  });
});
