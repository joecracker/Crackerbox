import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({ userData: "" }));
vi.mock("@/paths/paths", () => ({ getUserDataPath: () => h.userData }));

import { MAX_ITEM_CHARS, handoffStatus, writeHandoff } from "./agent_handoff";
import {
  MEMORY_LIMITS,
  readHandoffRecord,
  readMemoryFile,
  updateMemory,
} from "./agent_memory";

const APP = 3;
const CHAT = 41;
const T0 = new Date("2026-10-30T12:00:00Z");

const base = {
  doingNow:
    "Cutting the red sheets into panels; last step done: proof sheet. Next: fix four bad cuts.",
  gamePlan: [
    "Hand-fix the four bad cuts",
    "Re-run the proof sheet",
    "Wire the picker",
  ],
  questions: ["Do you want the cuts fixed first, or the picker?"],
};

beforeEach(() => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), "cb-handoff-"));
});
afterEach(() => {
  fs.rmSync(h.userData, { recursive: true, force: true });
});

describe("writeHandoff", () => {
  it("replaces state, adds decisions and facts, and records the handoff", () => {
    updateMemory(APP, {
      file: "state",
      mode: "replace_file",
      text: "old state",
    });
    const result = writeHandoff(
      APP,
      CHAT,
      {
        ...base,
        newDecisions: ["Muse test is out: she retastes the picture"],
        newFacts: ["Sheets are cut by cut-sheets.py"],
        carryOver: "Keep the proof sheet.",
      },
      T0,
    );
    expect(result).toMatch(/Handoff saved/);
    const state = readMemoryFile(APP, "state");
    expect(state).toContain("## Doing now");
    expect(state).toContain("- Hand-fix the four bad cuts");
    expect(state).toContain("## Questions to open with");
    expect(state).toContain("## Asked to carry over\nKeep the proof sheet.");
    expect(state).not.toContain("old state");
    expect(readMemoryFile(APP, "decisions")).toBe(
      "- [2026-10-30] Muse test is out: she retastes the picture",
    );
    expect(readMemoryFile(APP, "facts")).toBe(
      "- Sheets are cut by cut-sheets.py",
    );
    expect(readHandoffRecord(APP)).toEqual({
      chatId: CHAT,
      savedAt: T0.getTime(),
    });
  });

  it("does not add a decision or fact that is already there", () => {
    updateMemory(
      APP,
      { file: "decisions", mode: "append", text: "No cloud sync" },
      T0,
    );
    updateMemory(APP, { file: "facts", mode: "append", text: "Uses Vite" });
    writeHandoff(
      APP,
      CHAT,
      {
        ...base,
        newDecisions: ["no cloud sync", "Brand new rule"],
        newFacts: ["uses vite"],
      },
      T0,
    );
    expect(readMemoryFile(APP, "decisions")).toBe(
      "- [2026-10-30] No cloud sync\n- [2026-10-30] Brand new rule",
    );
    expect(readMemoryFile(APP, "facts")).toBe("Uses Vite");
  });

  it("saves nothing when the state would not fit", () => {
    updateMemory(APP, { file: "state", mode: "replace_file", text: "keep" });
    expect(() =>
      writeHandoff(APP, CHAT, {
        ...base,
        carryOver: "x".repeat(MEMORY_LIMITS.state),
      }),
    ).toThrow(/Nothing was saved/);
    expect(readMemoryFile(APP, "state")).toBe("keep");
    expect(readHandoffRecord(APP)).toBeNull();
  });

  it("saves nothing when the decisions file would overflow", () => {
    updateMemory(APP, {
      file: "decisions",
      mode: "replace_file",
      text: "- " + "d".repeat(MEMORY_LIMITS.decisions - 10),
    });
    updateMemory(APP, { file: "state", mode: "replace_file", text: "keep" });
    expect(() =>
      writeHandoff(APP, CHAT, {
        ...base,
        newDecisions: ["a fresh ruling that will not fit"],
      }),
    ).toThrow(/Condense it first/);
    expect(readMemoryFile(APP, "state")).toBe("keep");
    expect(readHandoffRecord(APP)).toBeNull();
  });

  it("insists on a real description, a plan and a question", () => {
    expect(() => writeHandoff(APP, CHAT, { ...base, doingNow: "  " })).toThrow(
      /doing_now/,
    );
    expect(() => writeHandoff(APP, CHAT, { ...base, gamePlan: [] })).toThrow(
      /game_plan/,
    );
    expect(() =>
      writeHandoff(APP, CHAT, {
        ...base,
        gamePlan: Array.from({ length: 7 }, (_, i) => `step ${i}`),
      }),
    ).toThrow(/game_plan/);
    expect(() => writeHandoff(APP, CHAT, { ...base, questions: [] })).toThrow(
      /questions/,
    );
    expect(() =>
      writeHandoff(APP, CHAT, { ...base, questions: ["a", "b", "c", "d"] }),
    ).toThrow(/questions/);
    expect(readHandoffRecord(APP)).toBeNull();
  });

  it("rejects an over-long item", () => {
    expect(() =>
      writeHandoff(APP, CHAT, {
        ...base,
        gamePlan: ["x".repeat(MAX_ITEM_CHARS + 1)],
      }),
    ).toThrow(/under 500/);
  });
});

describe("handoffStatus", () => {
  it("is saved only for the chat that wrote it, and only until the user writes again", () => {
    expect(handoffStatus(APP, CHAT, 0)).toEqual({
      saved: false,
      savedAt: null,
    });
    writeHandoff(APP, CHAT, base, T0);
    const t = T0.getTime();
    expect(handoffStatus(APP, CHAT, t - 5000)).toEqual({
      saved: true,
      savedAt: t,
    });
    expect(handoffStatus(APP, CHAT, t + 5000).saved).toBe(false);
    expect(handoffStatus(APP, CHAT + 1, 0)).toEqual({
      saved: false,
      savedAt: null,
    });
    expect(handoffStatus(APP + 1, CHAT, 0).saved).toBe(false);
  });
  it("ignores a damaged record", () => {
    writeHandoff(APP, CHAT, base, T0);
    fs.writeFileSync(
      path.join(h.userData, "agent-memory", `app-${APP}`, "handoff.json"),
      "{not json",
    );
    expect(handoffStatus(APP, CHAT, 0).saved).toBe(false);
  });
});
