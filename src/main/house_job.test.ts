import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/pro/main/ipc/handlers/local_agent/house", () => ({
  readRoster: () => [],
}));

import {
  finishHelperJob,
  jobPrompt,
  pickHelper,
  runHelperJob,
  stripDyadTags,
} from "./house_job";

const sister = (id: string, name: string, askEveryStep?: boolean) =>
  ({
    id,
    name,
    appId: id.length,
    color: "#000",
    initial: name[0],
    askEveryStep,
  }) as never;

const roster = [
  sister("dextra", "Dextra"),
  sister("laptop", "Dex's laptop", true),
];

describe("pickHelper", () => {
  it("says so when there is no helper", () => {
    expect(pickHelper([sister("dextra", "Dextra")]).error).toMatch(
      /no helper/i,
    );
  });
  it("takes the only helper without being told", () => {
    expect(pickHelper(roster).helper?.id).toBe("laptop");
  });
  it("matches by name or id, ignoring case, and rejects unknown names", () => {
    expect(pickHelper(roster, "DEX'S LAPTOP").helper?.id).toBe("laptop");
    expect(pickHelper(roster, "laptop").helper?.id).toBe("laptop");
    expect(pickHelper(roster, "nobody").error).toMatch(/No helper called/);
  });
  it("asks which one when there are several", () => {
    const two = [...roster, sister("other", "Other", true)];
    expect(pickHelper(two).error).toMatch(/more than one/i);
  });
});

describe("stripDyadTags and jobPrompt", () => {
  it("removes tool blocks and keeps the written text", () => {
    expect(
      stripDyadTags(
        'Done.<dyad-status title="x">noise</dyad-status> Two files.',
      ),
    ).toBe("Done. Two files.");
  });
  it("tells the helper the job is direct, approved, and where to work", () => {
    const p = jobPrompt({
      fromName: "Dextra",
      task: "List folders",
      folder: "C:\\x",
    });
    expect(p).toContain("List folders");
    expect(p).toContain("Work in this folder: C:\\x");
    expect(p).toContain("Do not send a letter");
  });
});

describe("runHelperJob", () => {
  it("hands the job over without forcing it on screen and returns the helper's final reply", async () => {
    const send = vi.fn((payload: { jobId?: string }) => {
      setTimeout(
        () => finishHelperJob(payload.jobId!, { chatId: 7, success: true }),
        0,
      );
      return true;
    });
    const out = await runHelperJob({
      roster,
      fromName: "Dextra",
      task: "do it",
      send,
      readReply: async () => "All done: 2 files.",
      newId: () => "job-1",
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ sisterId: "laptop", jobId: "job-1" }),
    );
    expect(send.mock.calls[0][0]).not.toHaveProperty("visible");
    expect(out).toContain("finished (chat #7)");
    expect(out).toContain("All done: 2 files.");
  });

  it("reports a stopped or failed run and a step-limit pause differently", async () => {
    const run = (outcome: { success: boolean; pausedByStepLimit?: boolean }) =>
      runHelperJob({
        roster,
        fromName: "Dextra",
        task: "t",
        send: (p) => {
          setTimeout(
            () => finishHelperJob(p.jobId!, { chatId: 3, ...outcome }),
            0,
          );
          return true;
        },
        readReply: async () => "partial",
      });
    expect(await run({ success: false })).toMatch(/did not finish/);
    expect(await run({ success: true, pausedByStepLimit: true })).toMatch(
      /step limit/,
    );
  });

  it("does not wait when the window cannot take the job", async () => {
    const out = await runHelperJob({
      roster,
      fromName: "Dextra",
      task: "t",
      send: () => false,
    });
    expect(out).toMatch(/not ready/);
  });

  it("stops waiting when Dextra's turn is cancelled", async () => {
    const controller = new AbortController();
    const p = runHelperJob({
      roster,
      fromName: "Dextra",
      task: "t",
      send: () => true,
      signal: controller.signal,
    });
    controller.abort();
    expect(await p).toMatch(/Stopped waiting/);
  });

  it("gives up politely at the time limit without cancelling anything", async () => {
    const out = await runHelperJob({
      roster,
      fromName: "Dextra",
      task: "t",
      send: () => true,
      maxWaitMs: 10,
    });
    expect(out).toMatch(/Nothing was cancelled/);
  });

  it("ignores a late answer for a job nobody is waiting for", () => {
    expect(finishHelperJob("gone", { chatId: 1, success: true })).toBe(false);
  });
});
