import { describe, expect, it, vi } from "vitest";

vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => "",
  getDyadAppPath: (p: string) => p,
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info() {}, warn() {}, error() {} }) },
}));

import { defaultJobs, pickDue, type ScheduleState } from "./house_schedule";

const empty = (): ScheduleState => ({ fired: {}, rolls: {}, counts: {} });
const jobs = () => defaultJobs().map((j) => ({ ...j, enabled: true }));

describe("pickDue daily", () => {
  it("fires once at its time and not again that day", () => {
    const at = new Date(2026, 10, 11, 7, 2);
    const first = pickDue(at, jobs(), empty(), () => 0.99);
    expect(first.due.map((j) => j.id)).toContain("nyx-morning");
    const again = pickDue(new Date(2026, 10, 11, 7, 3), jobs(), first.state, () => 0.99);
    expect(again.due.map((j) => j.id)).not.toContain("nyx-morning");
  });

  it("does not fire before its time", () => {
    const r = pickDue(new Date(2026, 10, 11, 6, 59), jobs(), empty(), () => 0.99);
    expect(r.due.map((j) => j.id)).not.toContain("nyx-morning");
  });

  it("catches up when the app opens a little late, but not too late", () => {
    const late = pickDue(new Date(2026, 10, 11, 8, 15), jobs(), empty(), () => 0.99);
    expect(late.due.map((j) => j.id)).toContain("nyx-morning");
    const tooLate = pickDue(new Date(2026, 10, 11, 14, 0), jobs(), empty(), () => 0.99);
    expect(tooLate.due.map((j) => j.id)).not.toContain("nyx-morning");
  });

  it("skips disabled jobs", () => {
    const r = pickDue(new Date(2026, 10, 11, 7, 2), defaultJobs(), empty(), () => 0.99);
    expect(r.due.map((j) => j.id)).toEqual(["nyx-morning"]);
  });
});

describe("pickDue dice", () => {
  it("rolls once an hour and fires on a lucky roll", () => {
    const noon = new Date(2026, 10, 11, 12, 5);
    const lucky = pickDue(noon, jobs(), empty(), () => 0);
    expect(lucky.due.map((j) => j.id)).toContain("nyx-surprise");
    const again = pickDue(new Date(2026, 10, 11, 12, 40), jobs(), lucky.state, () => 0);
    expect(again.due.map((j) => j.id)).not.toContain("nyx-surprise");
    const unlucky = pickDue(noon, jobs(), empty(), () => 0.99);
    expect(unlucky.due.map((j) => j.id)).not.toContain("nyx-surprise");
  });

  it("stays inside its window and respects the daily cap", () => {
    const night = pickDue(new Date(2026, 10, 11, 23, 5), jobs(), empty(), () => 0);
    expect(night.due.map((j) => j.id)).not.toContain("nyx-surprise");
    let state = empty();
    let fired = 0;
    for (const hour of [10, 11, 12, 13]) {
      const r = pickDue(new Date(2026, 10, 11, hour, 5), jobs(), state, () => 0);
      state = r.state;
      fired += r.due.filter((j) => j.id === "nyx-surprise").length;
    }
    expect(fired).toBe(2);
  });
});
