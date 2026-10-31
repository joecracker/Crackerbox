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

const trust = vi.hoisted(() => ({
  trusted: [] as string[],
  trustHostFolder: vi.fn(),
}));
vi.mock("./host_trust", () => ({
  isTrustedHostPath: (p: string) => trust.trusted.some((f) => p.startsWith(f)),
  trustHostFolder: trust.trustHostFolder,
}));

import { hostWriteFile, hostSearchReplace } from "./host_write";

let dir: string;
const ctx = (answer: boolean) =>
  ({ requireConsent: vi.fn().mockResolvedValue(answer) }) as any;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hostwrite-"));
  trust.trusted = [];
  trust.trustHostFolder.mockClear();
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

  it("does not ask for a folder the user already trusted", async () => {
    trust.trusted = [dir];
    const c = ctx(true);
    const f = path.join(dir, "b.txt");
    await hostWriteFile({ filePath: f, content: "quiet", ctx: c });
    expect(fs.readFileSync(f, "utf8")).toBe("quiet");
    expect(c.requireConsent).not.toHaveBeenCalled();
  });

  it("trusts the file's folder when the answer is Always allow", async () => {
    const c = {
      requireConsent: vi.fn(async (p: any) => {
        p.onAcceptAlways?.();
        return true;
      }),
    } as any;
    const f = path.join(dir, "c.txt");
    await hostWriteFile({ filePath: f, content: "x", ctx: c });
    expect(trust.trustHostFolder).toHaveBeenCalledWith(dir);
  });

  it("does not trust anything when the answer is Allow once", async () => {
    const c = ctx(true); // never calls onAcceptAlways
    await hostWriteFile({
      filePath: path.join(dir, "d.txt"),
      content: "x",
      ctx: c,
    });
    expect(trust.trustHostFolder).not.toHaveBeenCalled();
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
