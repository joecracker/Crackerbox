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

import { writeRoster } from "@/pro/main/ipc/handlers/local_agent/house";
import {
  defaultJobs,
  readJobPrompt,
  startHouseScheduler,
  writeSchedule,
  type ScheduleJob,
} from "./house_schedule";

const dextraJob = (): ScheduleJob => {
  const job = defaultJobs().find((j) => j.id === "dextra-morning");
  if (!job) throw new Error("dextra-morning is missing from the default jobs");
  return job;
};
const promptsDir = () => path.join(h.userData, "house", "prompts");

beforeEach(() => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), "cb-prompt-"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fs.rmSync(h.userData, { recursive: true, force: true });
});

describe("a job whose prompt lives in a local file", () => {
  it("carries no prompt text in the code, only the file it reads", () => {
    const job = dextraJob();
    expect(job.prompt).toBe("");
    expect(job.promptFile).toBe("prompts/dextra-morning.md");
  });

  it("reads the file, and a plain job still uses its own prompt", () => {
    fs.mkdirSync(promptsDir(), { recursive: true });
    fs.writeFileSync(
      path.join(promptsDir(), "dextra-morning.md"),
      "  hello there \n",
    );
    expect(readJobPrompt(dextraJob())).toBe("hello there");
    const plain = defaultJobs().find((j) => j.id === "nyx-morning")!;
    expect(readJobPrompt(plain)).toBe(plain.prompt);
  });

  it("gives nothing when the file is missing, empty or too long", () => {
    expect(readJobPrompt(dextraJob())).toBeNull();
    fs.mkdirSync(promptsDir(), { recursive: true });
    const file = path.join(promptsDir(), "dextra-morning.md");
    fs.writeFileSync(file, "   \n");
    expect(readJobPrompt(dextraJob())).toBeNull();
    fs.writeFileSync(file, "x".repeat(20_001));
    expect(readJobPrompt(dextraJob())).toBeNull();
  });

  it.each([
    "../house.json",
    "prompts/../house.json",
    "prompts/../../outside.md",
    "..\\outside.md",
    "prompts",
    "",
    path.join(os.tmpdir(), "elsewhere.md"),
  ])("never reads outside the prompts folder: %s", (promptFile) => {
    fs.mkdirSync(promptsDir(), { recursive: true });
    fs.writeFileSync(path.join(h.userData, "house", "house.json"), "{}");
    fs.writeFileSync(path.join(h.userData, "outside.md"), "secret");
    const job = { ...dextraJob(), prompt: "built-in", promptFile };
    // an empty promptFile means "no file", so that job simply uses its prompt
    expect(readJobPrompt(job)).toBe(promptFile === "" ? "built-in" : null);
  });
});

describe("the scheduler with a prompt file", () => {
  function setUpHouse() {
    writeRoster([
      {
        id: "dextra",
        name: "Dextra",
        appId: 9,
        color: "#ec4899",
        initial: "D",
      },
    ]);
    writeSchedule([dextraJob()]);
  }

  it("quietly skips when the file is missing, keeps its turn, and runs once the file is there", () => {
    setUpHouse();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.useFakeTimers({ now: new Date(2026, 10, 13, 7, 0, 0) });
    const send = vi.fn(() => true);
    const stop = startHouseScheduler(send);

    vi.advanceTimersByTime(15_000);
    expect(send).not.toHaveBeenCalled();
    const state = JSON.parse(
      fs.readFileSync(
        path.join(h.userData, "house", "schedule-state.json"),
        "utf8",
      ),
    );
    expect(state.counts["dextra-morning"]).toBeUndefined();

    fs.mkdirSync(promptsDir(), { recursive: true });
    fs.writeFileSync(
      path.join(promptsDir(), "dextra-morning.md"),
      "the local text",
    );
    vi.setSystemTime(new Date(2026, 10, 13, 8, 0, 30));
    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ sisterId: "dextra", prompt: "the local text" }),
    );
    stop();
  });
});
