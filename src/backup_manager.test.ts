// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

vi.mock("electron", () => ({
  app: { getVersion: () => "1.0.0", getPath: () => "" },
}));
vi.mock("electron-log", () => {
  const scope = { info() {}, debug() {}, warn() {}, error() {} };
  return { default: { scope: () => scope } };
});
// The real module is built for Electron; a copy-based stand-in is enough to
// exercise our own logic.
vi.mock("better-sqlite3", () => ({
  default: class {
    constructor(private readonly p: string) {}
    pragma() {}
    async backup(dest: string) {
      const { copyFile } = await import("fs/promises");
      await copyFile(this.p, dest);
    }
    close() {}
  },
}));

import { BackupManager } from "./backup_manager";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("BackupManager", () => {
  let dir: string;
  let settings: string;
  let db: string;
  let mgr: BackupManager;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cb-backup-"));
    settings = path.join(dir, "user-settings.json");
    db = path.join(dir, "sqlite.db");
    await fs.writeFile(settings, "settings-A");
    await fs.writeFile(db, "db-A");
    mgr = new BackupManager({
      settingsFile: settings,
      dbFile: db,
      userDataPath: dir,
      appVersion: "1.0.0",
    });
  });

  afterEach(async () => {
    mgr.stopScheduler();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("takes a backup on the very first run and records the version", async () => {
    await mgr.initialize();
    const list = await mgr.listBackups();
    expect(list).toHaveLength(1);
    expect(list[0].reason).toBe("daily");
    expect(await fs.readFile(path.join(dir, ".last_version"), "utf8")).toBe(
      "1.0.0",
    );
  });

  it("does not take a second backup within a day, even after a restart", async () => {
    await mgr.initialize();
    await mgr.initialize();
    expect(await mgr.listBackups()).toHaveLength(1);
  });

  it("backs up again when the newest backup is older than the limit", async () => {
    await mgr.initialize();
    await pause(5);
    expect(await mgr.ensureRecentBackup(1)).toBe(true);
    expect(await mgr.listBackups()).toHaveLength(2);
  });

  it("keeps only the newest 7 backups", async () => {
    await mgr.initialize();
    for (let i = 0; i < 9; i++) {
      await pause(5);
      await mgr.ensureRecentBackup(1);
    }
    expect(await mgr.listBackups()).toHaveLength(7);
  });

  it("restores settings and database, and keeps a pre_restore copy", async () => {
    await mgr.initialize();
    const [original] = await mgr.listBackups();
    await fs.writeFile(settings, "settings-B");
    await fs.writeFile(db, "db-B");
    await fs.writeFile(`${db}-wal`, "stale");
    await pause(5);

    await mgr.restoreBackup(original.name);

    expect(await fs.readFile(settings, "utf8")).toBe("settings-A");
    expect(await fs.readFile(db, "utf8")).toBe("db-A");
    await expect(fs.access(`${db}-wal`)).rejects.toThrow();
    const after = await mgr.listBackups();
    const pre = after.find((b) => b.reason === "pre_restore");
    expect(pre).toBeDefined();
    expect(
      await fs.readFile(
        path.join(dir, "backups", pre!.name, "sqlite.db"),
        "utf8",
      ),
    ).toBe("db-B");
  });

  it("refuses to restore a damaged backup and leaves live files alone", async () => {
    await mgr.initialize();
    const [original] = await mgr.listBackups();
    await fs.writeFile(
      path.join(dir, "backups", original.name, "sqlite.db"),
      "tampered",
    );
    await fs.writeFile(db, "db-B");

    await expect(mgr.restoreBackup(original.name)).rejects.toThrow(/damaged/);
    expect(await fs.readFile(db, "utf8")).toBe("db-B");
  });
});
