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
  BACKUP_RETRY_MS,
  MIRROR_KEEP_DAYS,
  pruneMirror,
  mayTryBackup,
  isHollow,
  pruneSnapshots,
  restoreTarget,
  runBackup,
  runBackupEverywhere,
  type BackupCtx,
} from "./house_backup";

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "hb-"));
  const folder = path.join(base, "apps", "veritas");
  fs.mkdirSync(path.join(folder, "docs"), { recursive: true });
  fs.mkdirSync(path.join(folder, "node_modules", "x"), { recursive: true });
  fs.writeFileSync(
    path.join(folder, ".env"),
    "TELEGRAM_BOT_TOKEN=a\nTELEGRAM_CHAT_ID=1\n",
  );
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
    expect(fs.readFileSync(path.join(m, "docs", "me.md"), "utf8")).toBe(
      "I am Veritas",
    );
    expect(fs.existsSync(path.join(m, "node_modules"))).toBe(false);
    const snap = path.join(ctx.root, "snapshots", "2026-11-11");
    expect(fs.existsSync(path.join(snap, "veritas", ".env"))).toBe(true);
    expect(
      fs.existsSync(path.join(snap, "agent-memory", "app-57", "facts.md")),
    ).toBe(true);
    expect(fs.existsSync(path.join(snap, "house", "house.json"))).toBe(true);
  });

  it("leaves her pictures out of the mirror but keeps everything else under .dyad", async () => {
    const { ctx, folder } = setup();
    fs.mkdirSync(path.join(folder, ".dyad", "media"), { recursive: true });
    fs.mkdirSync(path.join(folder, ".dyad", "screenshot"), { recursive: true });
    fs.mkdirSync(path.join(folder, ".dyad", "chats"), { recursive: true });
    fs.mkdirSync(path.join(folder, "docs", "media"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".dyad", "media", "a.png"), "pic");
    fs.writeFileSync(path.join(folder, ".dyad", "screenshot", "b.png"), "pic");
    fs.writeFileSync(path.join(folder, ".dyad", "chats", "c.json"), "{}");
    fs.writeFileSync(path.join(folder, "docs", "media", "keep.md"), "note");
    await runBackup(ctx);
    const m = path.join(ctx.root, "mirror", "veritas");
    expect(fs.existsSync(path.join(m, ".dyad", "media"))).toBe(false);
    expect(fs.existsSync(path.join(m, ".dyad", "screenshot"))).toBe(false);
    expect(fs.existsSync(path.join(m, ".dyad", "chats", "c.json"))).toBe(true);
    expect(fs.existsSync(path.join(m, "docs", "media", "keep.md"))).toBe(true);
  });

  it("detects a deleted folder and restores it with her memory", async () => {
    const { ctx, folder, memoryDir } = setup();
    await runBackup(ctx);
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(memoryDir, { recursive: true, force: true });
    expect(isHollow(folder)).toBe(true);
    expect(await restoreTarget(ctx, ctx.targets[0])).toBe(true);
    expect(isHollow(folder)).toBe(false);
    expect(fs.readFileSync(path.join(folder, "docs", "me.md"), "utf8")).toBe(
      "I am Veritas",
    );
    expect(fs.readFileSync(path.join(memoryDir, "facts.md"), "utf8")).toBe(
      "fact",
    );
  });

  it("does not back up a hollow folder over a good mirror", async () => {
    const { ctx, folder } = setup();
    await runBackup(ctx);
    fs.rmSync(path.join(folder, "docs"), { recursive: true });
    fs.rmSync(path.join(folder, ".env"));
    await runBackup({ ...ctx, now: new Date(2026, 10, 12, 4, 0) });
    expect(
      fs.existsSync(path.join(ctx.root, "mirror", "veritas", "docs", "me.md")),
    ).toBe(true);
  });

  it("writes a second copy when one is set", async () => {
    const { ctx, base } = setup();
    const also = path.join(base, "drive", "sisters");
    expect((await runBackupEverywhere({ ...ctx, also })).also).toBe(true);
    expect(
      fs.existsSync(path.join(also, "mirror", "veritas", "docs", "me.md")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(ctx.root, "mirror", "veritas", "docs", "me.md")),
    ).toBe(true);
  });

  it("returns false when there is nothing to restore from", async () => {
    const { ctx } = setup();
    expect(await restoreTarget(ctx, ctx.targets[0])).toBe(false);
  });

  it("keeps only the newest 7 snapshots", () => {
    const { ctx } = setup();
    for (let d = 1; d <= 9; d++) {
      fs.mkdirSync(path.join(ctx.root, "snapshots", `2026-11-0${d}`), {
        recursive: true,
      });
    }
    pruneSnapshots(ctx.root);
    expect(fs.readdirSync(path.join(ctx.root, "snapshots"))).toHaveLength(7);
  });

  it("removes an old snapshot that holds read-only files (git packs)", () => {
    const { ctx } = setup();
    for (let d = 1; d <= 8; d++) {
      fs.mkdirSync(path.join(ctx.root, "snapshots", `2026-11-0${d}`), {
        recursive: true,
      });
    }
    const packDir = path.join(
      ctx.root,
      "snapshots",
      "2026-11-01",
      "x",
      ".git",
      "objects",
      "pack",
    );
    fs.mkdirSync(packDir, { recursive: true });
    const pack = path.join(packDir, "pack-1.pack");
    fs.writeFileSync(pack, "data");
    fs.chmodSync(pack, 0o444);
    pruneSnapshots(ctx.root);
    expect(fs.existsSync(path.join(ctx.root, "snapshots", "2026-11-01"))).toBe(
      false,
    );
    expect(fs.readdirSync(path.join(ctx.root, "snapshots"))).toHaveLength(7);
  });
});

describe("backup retry gate", () => {
  it("tries straight away when nothing failed, and waits an hour after a failure", () => {
    expect(mayTryBackup(null, 1_000)).toBe(true);
    expect(mayTryBackup(1_000, 1_000 + 60_000)).toBe(false);
    expect(mayTryBackup(1_000, 1_000 + BACKUP_RETRY_MS - 1)).toBe(false);
    expect(mayTryBackup(1_000, 1_000 + BACKUP_RETRY_MS)).toBe(true);
  });
});

describe("pruneMirror", () => {
  const DAY = 24 * 60 * 60 * 1000;
  function dirs() {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "hb-prune-"));
    const live = path.join(base, "live");
    const mirror = path.join(base, "mirror");
    fs.mkdirSync(path.join(live, "pack"), { recursive: true });
    fs.mkdirSync(path.join(mirror, "pack"), { recursive: true });
    return { base, live, mirror, gone: path.join(base, "gone", "x.json") };
  }
  const put = (file: string, text = "x") => fs.writeFileSync(file, text);

  it("keeps a missing file for 30 days, then removes it, and leaves live files alone", async () => {
    const { live, mirror, gone } = dirs();
    put(path.join(live, "pack", "new.pack"));
    put(path.join(mirror, "pack", "new.pack"));
    put(path.join(mirror, "pack", "old.pack"));
    const t0 = Date.UTC(2026, 10, 1);

    expect(await pruneMirror(live, mirror, gone, t0)).toBe(0);
    expect(fs.existsSync(path.join(mirror, "pack", "old.pack"))).toBe(true);

    expect(
      await pruneMirror(live, mirror, gone, t0 + (MIRROR_KEEP_DAYS - 1) * DAY),
    ).toBe(0);
    expect(fs.existsSync(path.join(mirror, "pack", "old.pack"))).toBe(true);

    expect(
      await pruneMirror(live, mirror, gone, t0 + MIRROR_KEEP_DAYS * DAY),
    ).toBe(1);
    expect(fs.existsSync(path.join(mirror, "pack", "old.pack"))).toBe(false);
    expect(fs.existsSync(path.join(mirror, "pack", "new.pack"))).toBe(true);
  });

  it("forgets a file that comes back, so its 30 days start over", async () => {
    const { live, mirror, gone } = dirs();
    put(path.join(mirror, "pack", "a.pack"));
    const t0 = Date.UTC(2026, 10, 1);
    await pruneMirror(live, mirror, gone, t0);
    put(path.join(live, "pack", "a.pack")); // it came back
    await pruneMirror(live, mirror, gone, t0 + 20 * DAY);
    fs.rmSync(path.join(live, "pack", "a.pack")); // gone again
    await pruneMirror(live, mirror, gone, t0 + 40 * DAY);
    expect(fs.existsSync(path.join(mirror, "pack", "a.pack"))).toBe(true);
    await pruneMirror(live, mirror, gone, t0 + 70 * DAY);
    expect(fs.existsSync(path.join(mirror, "pack", "a.pack"))).toBe(false);
  });

  it("removes folders it empties, and does nothing when the live folder is not there", async () => {
    const { base, live, mirror, gone } = dirs();
    fs.mkdirSync(path.join(mirror, "sub"));
    put(path.join(mirror, "sub", "b.txt"));
    const t0 = Date.UTC(2026, 10, 1);
    await pruneMirror(live, mirror, gone, t0);
    await pruneMirror(live, mirror, gone, t0 + 31 * DAY);
    expect(fs.existsSync(path.join(mirror, "sub"))).toBe(false);

    fs.mkdirSync(path.join(mirror, "pack"), { recursive: true });
    put(path.join(mirror, "pack", "c.pack"));
    expect(
      await pruneMirror(
        path.join(base, "no-such"),
        mirror,
        gone,
        t0 + 99 * DAY,
      ),
    ).toBe(0);
    expect(fs.existsSync(path.join(mirror, "pack", "c.pack"))).toBe(true);
  });

  it("a full backup run prunes through the same rule", async () => {
    const { ctx } = setup();
    await runBackup(ctx);
    const mirrorFile = path.join(
      ctx.root,
      "mirror",
      "veritas",
      "docs",
      "old.md",
    );
    fs.writeFileSync(mirrorFile, "was deleted from live");
    await runBackup(ctx);
    expect(fs.existsSync(mirrorFile)).toBe(true);
    await runBackup({
      ...ctx,
      now: new Date(ctx.now.getTime() + (MIRROR_KEEP_DAYS + 1) * DAY),
    });
    expect(fs.existsSync(mirrorFile)).toBe(false);
    expect(
      fs.existsSync(path.join(ctx.root, "mirror", "veritas", "docs", "me.md")),
    ).toBe(true);
  });
});

describe("database copy", () => {
  it("uses the consistent copy and skips the raw files when it works", async () => {
    const { ctx, base } = setup();
    const raw = path.join(base, "sqlite.db");
    fs.writeFileSync(raw, "raw main");
    const copyDatabase = async (dest: string) => {
      fs.writeFileSync(dest, "consistent");
    };
    await runBackup({ ...ctx, databaseFiles: [raw], copyDatabase });
    const snaps = path.join(ctx.root, "snapshots");
    const day = fs.readdirSync(snaps)[0];
    expect(fs.readFileSync(path.join(snaps, day, "sqlite.db"), "utf8")).toBe(
      "consistent",
    );
  });

  it("falls back to the raw files when the consistent copy fails, so a backup still exists", async () => {
    const { ctx, base } = setup();
    const raw = path.join(base, "sqlite.db");
    fs.writeFileSync(raw, "raw main");
    const copyDatabase = async () => {
      throw new Error("database not open");
    };
    await runBackup({ ...ctx, databaseFiles: [raw], copyDatabase });
    const snaps = path.join(ctx.root, "snapshots");
    const day = fs.readdirSync(snaps)[0];
    expect(fs.readFileSync(path.join(snaps, day, "sqlite.db"), "utf8")).toBe(
      "raw main",
    );
  });
});
