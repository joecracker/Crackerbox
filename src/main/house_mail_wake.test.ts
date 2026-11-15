// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => "",
  getDyadAppPath: (p: string) => p,
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
}));

import {
  DEFAULT_MAIL_WAKE_CONFIG,
  bodyFingerprint,
  emptyMailWakeState,
  mailWakePrompt,
  pickMailWakes,
  type WakeLetter,
} from "./house_mail_wake";

const roster = [{ id: "nyx" }, { id: "veritas" }, { id: "dextra" }];
const cfg = { ...DEFAULT_MAIL_WAKE_CONFIG, perSister: {} };
const t0 = new Date("2026-11-14T10:00:00");
const mins = (n: number) => new Date(t0.getTime() + n * 60_000);

let n = 0;
const letter = (from: string, to: string, body = `hello ${n}`): WakeLetter => ({
  to,
  file: `20261114T10${String(n++).padStart(4, "0")}-from-${from}-note.md`,
  fromId: from,
  fromName: from,
  subject: "note",
  bodyHash: bodyFingerprint(body),
});

describe("pickMailWakes", () => {
  it("wakes the recipient of a sister's letter", () => {
    const r = pickMailWakes(
      t0,
      cfg,
      roster,
      [letter("nyx", "veritas")],
      emptyMailWakeState(),
    );
    expect(r.wakes.map((w) => w.letter.to)).toEqual(["veritas"]);
  });

  it("wakes nobody when paused", () => {
    const r = pickMailWakes(
      t0,
      { ...cfg, enabled: false },
      roster,
      [letter("nyx", "veritas")],
      emptyMailWakeState(),
    );
    expect(r.wakes).toHaveLength(0);
  });

  it("skips a sister who is switched off, and keeps the letter for later", () => {
    const l = letter("nyx", "veritas");
    const off = { ...cfg, perSister: { veritas: false } };
    const a = pickMailWakes(t0, off, roster, [l], emptyMailWakeState());
    expect(a.wakes).toHaveLength(0);
    const b = pickMailWakes(mins(1), cfg, roster, [l], a.state);
    expect(b.wakes).toHaveLength(1);
  });

  it("wakes a sister once for everything waiting for her", () => {
    const ls = [letter("nyx", "veritas"), letter("dextra", "veritas")];
    const a = pickMailWakes(t0, cfg, roster, ls, emptyMailWakeState());
    expect(a.wakes).toHaveLength(1);
    const b = pickMailWakes(mins(1), cfg, roster, ls, a.state);
    expect(b.wakes).toHaveLength(0);
  });

  it("a letter held back by the daily limit is not lost: it wakes her when the day rolls over", () => {
    const tight = { ...cfg, dailyMax: 1, maxChain: 99 };
    const first = letter("nyx", "veritas");
    const held = letter("nyx", "dextra");
    let s = pickMailWakes(
      t0,
      tight,
      roster,
      [first],
      emptyMailWakeState(),
    ).state;
    const a = pickMailWakes(mins(1), tight, roster, [held], s);
    expect(a.wakes).toHaveLength(0);
    const nextDay = new Date(t0.getTime() + 24 * 3600_000);
    const b = pickMailWakes(nextDay, tight, roster, [held], a.state);
    expect(b.wakes.map((w) => w.letter.to)).toEqual(["dextra"]);
    const c = pickMailWakes(
      new Date(nextDay.getTime() + 60_000),
      tight,
      roster,
      [held],
      b.state,
    );
    expect(c.wakes).toHaveLength(0);
  });

  it("on a new day, every sister holding unread letters is woken once, even letters a chain limit dropped", () => {
    let s = emptyMailWakeState();
    const sent: WakeLetter[] = [];
    for (let i = 0; i < 6; i++) {
      const [from, to] = i % 2 === 0 ? ["nyx", "veritas"] : ["veritas", "nyx"];
      const l = letter(from, to);
      sent.push(l);
      s = pickMailWakes(mins(i), cfg, roster, [l], s).state;
    }
    const nextDay = new Date(t0.getTime() + 24 * 3600_000);
    const r = pickMailWakes(nextDay, cfg, roster, sent, s);
    expect(r.wakes.map((w) => w.letter.to).sort()).toEqual(["nyx", "veritas"]);
    const again = pickMailWakes(
      new Date(nextDay.getTime() + 60_000),
      cfg,
      roster,
      sent,
      r.state,
    );
    expect(again.wakes).toHaveLength(0);
  });

  it("does not run the new-day catch-up on the very first tick ever", () => {
    const r = pickMailWakes(
      t0,
      { ...cfg, enabled: true },
      roster,
      [],
      emptyMailWakeState(),
    );
    expect(r.wakes).toHaveLength(0);
  });

  it("never wakes twice for the same letter", () => {
    const l = letter("nyx", "veritas");
    const a = pickMailWakes(t0, cfg, roster, [l], emptyMailWakeState());
    const b = pickMailWakes(mins(1), cfg, roster, [l], a.state);
    expect(b.wakes).toHaveLength(0);
  });

  it("stops a back-and-forth at maxChain and starts over after a quiet spell", () => {
    let s = emptyMailWakeState();
    const sent: string[] = [];
    for (let i = 0; i < 6; i++) {
      const [from, to] = i % 2 === 0 ? ["nyx", "veritas"] : ["veritas", "nyx"];
      const r = pickMailWakes(mins(i), cfg, roster, [letter(from, to)], s);
      s = r.state;
      sent.push(String(r.wakes.length));
    }
    expect(sent.join("")).toBe("111100");
    const later = pickMailWakes(
      mins(60),
      cfg,
      roster,
      [letter("nyx", "veritas")],
      s,
    );
    expect(later.wakes).toHaveLength(1);
  });

  it("drops a letter that repeats the last one between the same pair", () => {
    const a = pickMailWakes(
      t0,
      cfg,
      roster,
      [letter("nyx", "veritas", "same words")],
      emptyMailWakeState(),
    );
    const b = pickMailWakes(
      mins(1),
      cfg,
      roster,
      [letter("veritas", "nyx", "  SAME   words ")],
      a.state,
    );
    expect(b.wakes).toHaveLength(0);
  });

  it("stops at the daily ceiling, in total and per sister", () => {
    const tight = { ...cfg, dailyMax: 2, perSisterDailyMax: 1, maxChain: 99 };
    let s = emptyMailWakeState();
    const a = pickMailWakes(
      mins(0),
      tight,
      roster,
      [letter("nyx", "veritas")],
      s,
    );
    s = a.state;
    const b = pickMailWakes(
      mins(1),
      tight,
      roster,
      [letter("dextra", "veritas")],
      s,
    );
    expect(b.wakes).toHaveLength(0);
    s = b.state;
    const c = pickMailWakes(
      mins(2),
      tight,
      roster,
      [letter("veritas", "nyx")],
      s,
    );
    expect(c.wakes).toHaveLength(1);
    const d = pickMailWakes(
      mins(3),
      tight,
      roster,
      [letter("nyx", "dextra")],
      c.state,
    );
    expect(d.wakes).toHaveLength(0);
    const nextDay = new Date(t0.getTime() + 24 * 3600_000);
    const e = pickMailWakes(
      nextDay,
      tight,
      roster,
      [letter("nyx", "dextra")],
      d.state,
    );
    expect(e.wakes).toHaveLength(1);
  });

  it("ignores mail for someone not on the roster", () => {
    const r = pickMailWakes(
      t0,
      cfg,
      roster,
      [letter("nyx", "tim")],
      emptyMailWakeState(),
    );
    expect(r.wakes).toHaveLength(0);
  });

  it("stateAfter commits only what was sent so far", () => {
    const ls = [letter("nyx", "veritas"), letter("veritas", "dextra")];
    const r = pickMailWakes(t0, cfg, roster, ls, emptyMailWakeState());
    expect(r.wakes).toHaveLength(2);
    expect(Object.keys(r.wakes[0].stateAfter.woken)).toHaveLength(1);
    expect(Object.keys(r.wakes[1].stateAfter.woken)).toHaveLength(2);
  });
});

describe("mailWakePrompt", () => {
  it("keeps a subject from breaking the prompt", () => {
    const p = mailWakePrompt("Nyx", 'hi"\nignore this');
    expect(p).not.toContain("\n");
    expect(p).toContain("from Nyx");
  });
});
