// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({
  userData: "",
  nextAppId: 100,
  chat: undefined as { appId: number; sisterId: string | null } | undefined,
}));
vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => h.userData,
  getDyadAppPath: (p: string) => path.join(h.userData, "apps", p),
}));
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: () => ({ returning: async () => [{ id: h.nextAppId++ }] }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (h.chat ? [h.chat] : []) }),
      }),
    }),
  },
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => ({}),
  writeSettings: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
}));

import {
  readRoster,
  writeRoster,
} from "@/pro/main/ipc/handlers/local_agent/house";
import { addEntity, helperRulesText } from "./house_entity";
import {
  entityConsentFor,
  forgetEntityAlways,
  listEntityAlways,
  rememberEntityAlways,
  strictEntityForChat,
} from "./house_consent";

beforeEach(() => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), "cb-consent-"));
  h.chat = undefined;
});
afterEach(() => {
  try {
    fs.rmSync(h.userData, { recursive: true, force: true });
  } catch {
    // a temp folder that cannot be removed is not a test failure
  }
});

describe("entityConsentFor", () => {
  it("says nothing about an ordinary entity", () => {
    expect(entityConsentFor(undefined, "read_file")).toBeUndefined();
    expect(entityConsentFor({}, "read_file")).toBeUndefined();
    expect(
      entityConsentFor({ toolConsents: { read_file: "always" } }, "read_file"),
    ).toBeUndefined();
  });

  it("asks for every tool of a helper, even ones that are always-allow by default", () => {
    const helper = { askEveryStep: true };
    expect(entityConsentFor(helper, "read_file")).toBe("ask");
    expect(entityConsentFor(helper, "write_file")).toBe("ask");
    expect(entityConsentFor(helper, "run_command")).toBe("ask");
  });

  it("allows only the tools Tim said Always allow to for this helper", () => {
    const helper = {
      askEveryStep: true,
      toolConsents: { run_command: "always" as const },
    };
    expect(entityConsentFor(helper, "run_command")).toBe("always");
    expect(entityConsentFor(helper, "write_file")).toBe("ask");
  });
});

describe("remembering Always allow", () => {
  beforeEach(() => {
    writeRoster([
      { id: "nyx", name: "Nyx", appId: 1, color: "#000000", initial: "N" },
      {
        id: "dexs-laptop",
        name: "Dex's laptop",
        appId: 2,
        color: "#111111",
        initial: "D",
        askEveryStep: true,
      },
    ]);
  });

  it("is kept on the helper and leaves the other entities untouched", () => {
    rememberEntityAlways("dexs-laptop", "run_command");
    const roster = readRoster();
    expect(roster[1].toolConsents).toEqual({ run_command: "always" });
    expect(roster[0]).not.toHaveProperty("toolConsents");
    expect(listEntityAlways("dexs-laptop")).toEqual(["run_command"]);
  });

  it("is ignored for an entity that does not ask every step", () => {
    rememberEntityAlways("nyx", "run_command");
    expect(readRoster()[0]).not.toHaveProperty("toolConsents");
  });

  it("can be undone one tool at a time", () => {
    rememberEntityAlways("dexs-laptop", "run_command");
    rememberEntityAlways("dexs-laptop", "write_file");
    forgetEntityAlways("dexs-laptop", "run_command");
    expect(listEntityAlways("dexs-laptop")).toEqual(["write_file"]);
    forgetEntityAlways("dexs-laptop", "write_file");
    expect(readRoster()[1]).not.toHaveProperty("toolConsents");
  });
});

describe("strictEntityForChat", () => {
  beforeEach(() => {
    writeRoster([
      { id: "nyx", name: "Nyx", appId: 1, color: "#000000", initial: "N" },
      {
        id: "dexs-laptop",
        name: "Dex's laptop",
        appId: 2,
        color: "#111111",
        initial: "D",
        askEveryStep: true,
      },
    ]);
  });

  it("finds the helper for a chat in its own room", async () => {
    h.chat = { appId: 2, sisterId: null };
    expect((await strictEntityForChat(7))?.id).toBe("dexs-laptop");
  });

  it("finds the helper when it is picked as the speaker in another room", async () => {
    h.chat = { appId: 1, sisterId: "dexs-laptop" };
    expect((await strictEntityForChat(7))?.id).toBe("dexs-laptop");
  });

  it("finds nothing for an ordinary entity's chat, or an unknown chat", async () => {
    h.chat = { appId: 1, sisterId: "nyx" };
    expect(await strictEntityForChat(7)).toBeUndefined();
    h.chat = undefined;
    expect(await strictEntityForChat(8)).toBeUndefined();
  });
});

describe("adding a helper", () => {
  it("makes a no-personality entity on the Claude subscription that asks every step", async () => {
    const s = await addEntity({
      name: "Dex's laptop",
      helper: true,
      personality: "Pirate",
      temperature: 1.6,
    });
    expect(s.id).toBe("dex-s-laptop");
    expect(s.askEveryStep).toBe(true);
    expect(s.modelSelection?.provider).toBe("claude-code");
    expect(s).not.toHaveProperty("temperature");
    const rules = fs.readFileSync(
      path.join(h.userData, "apps", s.id, "AI_RULES.md"),
      "utf8",
    );
    expect(rules).toBe(helperRulesText("Dex's laptop"));
    expect(rules).not.toContain("Pirate");
  });

  it("leaves an ordinary entity exactly as before", async () => {
    const s = await addEntity({ name: "Quill", personality: "Calm" });
    expect(s).not.toHaveProperty("askEveryStep");
    expect(s).not.toHaveProperty("modelSelection");
  });
});
