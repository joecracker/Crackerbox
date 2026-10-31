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

  function fillDecisions(lines: number) {
    const text = Array.from(
      { length: lines },
      (_, i) => `- [2026-10-01] ruling number ${i} ${"d".repeat(90)}`,
    ).join("\n");
    updateMemory(APP, { file: "decisions", mode: "replace_file", text });
    return text.split("\n");
  }

  it("moves the oldest decision lines to an archive instead of refusing", () => {
    const old = fillDecisions(40); // just under the 5000 limit
    const result = writeHandoff(APP, CHAT, {
      ...base,
      newDecisions: ["a fresh ruling " + "n".repeat(300)],
    });
    expect(result).toMatch(
      /older decision line\(s\) moved to topics\/decisions-archive/,
    );
    const kept = readMemoryFile(APP, "decisions");
    expect(kept.length).toBeLessThanOrEqual(MEMORY_LIMITS.decisions);
    expect(kept).toContain("a fresh ruling");
    expect(kept).not.toContain(old[0]); // the oldest went
    expect(kept).toContain(old[old.length - 1]); // the newest stayed
    const archive = readMemoryFile(APP, "decisions-archive");
    expect(archive.split("\n")[0]).toMatch(/^# Older decisions/);
    expect(archive).toContain(old[0]);
    expect(readHandoffRecord(APP)?.chatId).toBe(CHAT);
  });

  it("moves old facts out the same way", () => {
    const text = Array.from(
      { length: 36 },
      (_, i) => `- fact ${i} ${"f".repeat(120)}`,
    ).join("\n");
    updateMemory(APP, { file: "facts", mode: "replace_file", text });
    writeHandoff(APP, CHAT, { ...base, newFacts: ["x".repeat(480)] });
    expect(readMemoryFile(APP, "facts").length).toBeLessThanOrEqual(
      MEMORY_LIMITS.facts,
    );
    expect(readMemoryFile(APP, "facts-archive")).toContain("- fact 0 ");
  });

  it("starts a second archive file when the first is full", () => {
    fillDecisions(40);
    for (let i = 0; i < 26; i++) {
      writeHandoff(APP, CHAT + i, {
        ...base,
        newDecisions: [`round ${i} ` + "r".repeat(480)],
      });
    }
    expect(readMemoryFile(APP, "decisions-archive").length).toBeLessThanOrEqual(
      8000,
    );
    expect(readMemoryFile(APP, "decisions-archive-2")).not.toBe("");
    expect(readMemoryFile(APP, "decisions").length).toBeLessThanOrEqual(
      MEMORY_LIMITS.decisions,
    );
  });

  it("keeps decisions as they were when a state error stops the handoff", () => {
    fillDecisions(40);
    const before = readMemoryFile(APP, "decisions");
    expect(() =>
      writeHandoff(APP, CHAT, {
        ...base,
        newDecisions: ["a fresh ruling " + "n".repeat(300)],
        carryOver: "x".repeat(MEMORY_LIMITS.state),
      }),
    ).toThrow(/Nothing was saved/);
    expect(readMemoryFile(APP, "decisions")).toBe(before);
    expect(readMemoryFile(APP, "decisions-archive")).toBe("");
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
