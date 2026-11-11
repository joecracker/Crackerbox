import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => "",
  getDyadAppPath: (p: string) => p,
  getElectron: () => undefined,
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info() {}, warn() {}, error() {} }) },
}));

import {
  isHollow,
  pruneSnapshots,
  restoreTarget,
  runBackup,
  type BackupCtx,
} from "./house_backup";

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "hb-"));
  const folder = path.join(base, "apps", "veritas");
  fs.mkdirSync(path.join(folder, "docs"), { recursive: true });
  fs.mkdirSync(path.join(folder, "node_modules", "x"), { recursive: true });
  fs.writeFileSync(path.join(folder, ".env"), "TELEGRAM_BOT_TOKEN=a\nTELEGRAM_CHAT_ID=1\n");
  fs.writeFileSync(path.join(folder, "docs", "me.md"), "I am Veritas");
  fs.writeFileSync(path.join(folder, "node_modules", "x", "big.js"), "junk");
  const memoryDir = path.join(base, "agent-memory", "app-57");
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(path.join(memoryDir, "facts.md"), "fact");
  const house = path.join(base, "house");
  fs.mkdirSync(house);
  fs.writeFileSync(path.join(house, "house.json"), "{}");
  const ctx: BackupCtx = {
    root: path.join(base, "bk"),
    targets: [{ id: "veritas", folder, memoryDir }],
    houseDir: house,
    extraFiles: [],
    now: new Date(2026, 10, 11, 4, 0),
  };
  return { base, folder, memoryDir, ctx };
}

describe("house backup", () => {
  it("mirrors without node_modules and snapshots identity + memory", async () => {
    const { ctx } = setup();
    await runBackup(ctx);
    const m = path.join(ctx.root, "mirror", "veritas");
    expect(fs.readFileSync(path.join(m, "docs", "me.md"), "utf8")).toBe("I am Veritas");
    expect(fs.existsSync(path.join(m, "node_modules"))).toBe(false);
    const snap = path.join(ctx.root, "snapshots", "2026-11-11");
    expect(fs.existsSync(path.join(snap, "veritas", ".env"))).toBe(true);
    expect(fs.existsSync(path.join(snap, "agent-memory", "app-57", "facts.md"))).toBe(true);
    expect(fs.existsSync(path.join(snap, "house", "house.json"))).toBe(true);
  });

  it("detects a deleted folder and restores it with her memory", async () => {
    const { ctx, folder, memoryDir } = setup();
    await runBackup(ctx);
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(memoryDir, { recursive: true, force: true });
    expect(isHollow(folder)).toBe(true);
    expect(await restoreTarget(ctx, ctx.targets[0])).toBe(true);
    expect(isHollow(folder)).toBe(false);
    expect(fs.readFileSync(path.join(folder, "docs", "me.md"), "utf8")).toBe("I am Veritas");
    expect(fs.readFileSync(path.join(memoryDir, "facts.md"), "utf8")).toBe("fact");
  });

  it("does not back up a hollow folder over a good mirror", async () => {
    const { ctx, folder } = setup();
    await runBackup(ctx);
    fs.rmSync(path.join(folder, "docs"), { recursive: true });
    fs.rmSync(path.join(folder, ".env"));
    await runBackup({ ...ctx, now: new Date(2026, 10, 12, 4, 0) });
    expect(fs.existsSync(path.join(ctx.root, "mirror", "veritas", "docs", "me.md"))).toBe(true);
  });

  it("returns false when there is nothing to restore from", async () => {
    const { ctx } = setup();
    expect(await restoreTarget(ctx, ctx.targets[0])).toBe(false);
  });

  it("keeps only the newest 7 snapshots", () => {
    const { ctx } = setup();
    for (let d = 1; d <= 9; d++) {
      fs.mkdirSync(path.join(ctx.root, "snapshots", `2026-11-0${d}`), { recursive: true });
    }
    pruneSnapshots(ctx.root);
    expect(fs.readdirSync(path.join(ctx.root, "snapshots"))).toHaveLength(7);
  });
});