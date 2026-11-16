// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const h = vi.hoisted(() => ({ userData: "" }));
vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => h.userData,
  getDyadAppPath: (p: string) => p,
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
}));

import {
  checkPlan,
  clearPlan,
  parseStatus,
  readPlan,
  savePlan,
  type ApprovedPlan,
} from "./house_plan";

const plan = (over: Partial<ApprovedPlan> = {}): ApprovedPlan => ({
  summary: "fix a thing",
  files: ["src/a.ts", "src/b.ts"],
  head: "abc123",
  approvedAt: "2026-11-16T13:00:00.000Z",
  ...over,
});

beforeEach(() => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), "cb-plan-"));
});
afterEach(() => {
  fs.rmSync(h.userData, { recursive: true, force: true });
});

describe("checkPlan", () => {
  it("passes when only planned files changed, in any slash style or case", () => {
    expect(checkPlan(plan(), ["src\\A.ts", "src/b.ts"], "abc123").ok).toBe(
      true,
    );
  });
  it("passes when a planned file did not end up changed", () => {
    expect(checkPlan(plan(), ["src/a.ts"], "abc123").ok).toBe(true);
  });
  it("stops on a file that was not in the plan and names it", () => {
    const r = checkPlan(plan(), ["src/a.ts", "src/secret.ts"], "abc123");
    expect(r.ok).toBe(false);
    expect(r.extra).toEqual(["src/secret.ts"]);
  });
  it("stops when there is no plan", () => {
    const r = checkPlan(null, ["src/a.ts"], "abc123");
    expect(r.ok).toBe(false);
    expect(r.extra).toEqual(["src/a.ts"]);
  });
  it("stops when the code moved to another commit after approval", () => {
    expect(checkPlan(plan(), ["src/a.ts"], "def456").ok).toBe(false);
  });
});

describe("parseStatus", () => {
  it("reads changed, new and renamed files", () => {
    const out = " M src/a.ts\0?? src/new.ts\0R  src/to.ts\0src/from.ts\0";
    expect(parseStatus(out)).toEqual([
      "src/a.ts",
      "src/new.ts",
      "src/to.ts",
      "src/from.ts",
    ]);
  });
});

describe("the saved plan", () => {
  it("round-trips, and is gone once cleared", () => {
    expect(readPlan()).toBeNull();
    savePlan(plan());
    expect(readPlan()?.files).toEqual(["src/a.ts", "src/b.ts"]);
    clearPlan();
    expect(readPlan()).toBeNull();
  });
  it("treats a damaged file as no plan", () => {
    fs.mkdirSync(path.join(h.userData, "house"), { recursive: true });
    fs.writeFileSync(path.join(h.userData, "house", "approved-plan.json"), "{");
    expect(readPlan()).toBeNull();
  });
});

describe("the private-text commit guard", () => {
  const script = path.resolve("housemaster", "check-private.mjs");
  const secret =
    "Wake slowly and send Daddy a picture of the sunlit window with the curtains half drawn and the quilt kicked off.";
  let repo = "";
  let house = "";

  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  const runGuard = () =>
    spawnSync("node", [script], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, CB_HOUSE_DIR: house },
    });

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "cb-guard-repo-"));
    house = fs.mkdtempSync(path.join(os.tmpdir(), "cb-guard-house-"));
    fs.mkdirSync(path.join(house, "prompts"));
    fs.writeFileSync(path.join(house, "prompts", "p.md"), secret);
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    fs.writeFileSync(path.join(repo, "a.ts"), "export const a = 1;\n");
    git("add", ".");
    git("commit", "-q", "-m", "init");
  });
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(house, { recursive: true, force: true });
  });

  it("blocks a commit that carries the private text, without printing it", () => {
    fs.writeFileSync(
      path.join(repo, "a.ts"),
      `export const p = "${secret}";\n`,
    );
    git("add", ".");
    const r = runGuard();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("a.ts");
    expect(r.stderr).not.toContain("sunlit");
  });
  it("lets an ordinary commit through", () => {
    fs.writeFileSync(path.join(repo, "a.ts"), "export const a = 2;\n");
    git("add", ".");
    expect(runGuard().status).toBe(0);
  });
  it("does nothing when there is no house folder", () => {
    fs.rmSync(path.join(house, "prompts"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "a.ts"),
      `export const p = "${secret}";\n`,
    );
    git("add", ".");
    expect(runGuard().status).toBe(0);
  });
});
