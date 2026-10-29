import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));
vi.mock("./host_read", () => ({
  assertHostPathAllowed: (p: string) => {
    if (/[\\/]\.ssh([\\/]|$)/i.test(p)) throw new Error("blocked");
  },
}));

import { hostWriteFile, hostSearchReplace } from "./host_write";

let dir: string;
const ctx = (answer: boolean) =>
  ({ requireConsent: vi.fn().mockResolvedValue(answer) }) as any;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hostwrite-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("host_write", () => {
  it("asks every time, then writes", async () => {
    const c = ctx(true);
    const f = path.join(dir, "a.txt");
    await hostWriteFile({ filePath: f, content: "hi", ctx: c });
    expect(fs.readFileSync(f, "utf8")).toBe("hi");
    expect(c.requireConsent).toHaveBeenCalledWith(
      expect.objectContaining({ forceAsk: true }),
    );
  });

  it("does not write when declined", async () => {
    const f = path.join(dir, "a.txt");
    await expect(
      hostWriteFile({ filePath: f, content: "hi", ctx: ctx(false) }),
    ).rejects.toThrow(/declined/);
    expect(fs.existsSync(f)).toBe(false);
  });

  it("refuses blocked folders and program files without asking", async () => {
    const c = ctx(true);
    await expect(
      hostWriteFile({
        filePath: path.join(dir, ".ssh", "x.txt"),
        content: "x",
        ctx: c,
      }),
    ).rejects.toThrow();
    await expect(
      hostWriteFile({
        filePath: path.join(dir, "run.bat"),
        content: "x",
        ctx: c,
      }),
    ).rejects.toThrow(/not allowed/);
    expect(c.requireConsent).not.toHaveBeenCalled();
  });

  it("edits with search/replace after approval", async () => {
    const f = path.join(dir, "p.md");
    fs.writeFileSync(f, "one\ntwo\nthree\n");
    await hostSearchReplace({
      filePath: f,
      oldString: "two",
      newString: "2",
      ctx: ctx(true),
    });
    expect(fs.readFileSync(f, "utf8")).toBe("one\n2\nthree\n");
  });
});
