import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userData = "";
vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => userData,
  getDyadAppPath: (p: string) => path.join(userData, "apps", p),
}));

import {
  DOOR_OPEN_MAX_MS,
  doorIsOpen,
  doorReceive,
  doorSend,
  houseDir,
} from "./house";

describe("front door", () => {
  let doorFolder = "";

  const openDoor = (ageMs = 0) => {
    const f = path.join(houseDir(), "door-open");
    fs.writeFileSync(f, "");
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(f, t, t);
  };

  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), "door-ud-"));
    doorFolder = fs.mkdtempSync(path.join(os.tmpdir(), "door-drive-"));
    fs.mkdirSync(houseDir(), { recursive: true });
    fs.writeFileSync(
      path.join(houseDir(), "door.json"),
      JSON.stringify({ path: doorFolder }),
    );
    fs.mkdirSync(path.join(doorFolder, "in"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(doorFolder, { recursive: true, force: true });
  });

  it("is closed when Tim has not opened it, and reads nothing", () => {
    fs.writeFileSync(path.join(doorFolder, "in", "a.md"), "hello");
    expect(doorIsOpen()).toBe(false);
    expect(doorReceive()).toContain("closed");
    expect(fs.existsSync(path.join(doorFolder, "in", "a.md"))).toBe(true);
    expect(doorSend("Nyx", "hi", "hello")).toContain("closed");
    expect(fs.existsSync(path.join(doorFolder, "out"))).toBe(false);
  });

  it("lapses by itself after the time limit", () => {
    openDoor(DOOR_OPEN_MAX_MS + 1000);
    expect(doorIsOpen()).toBe(false);
  });

  it("reads new letters as words from a stranger and files them away", () => {
    openDoor();
    fs.writeFileSync(path.join(doorFolder, "in", "muse-1.md"), "Hi girls");
    fs.writeFileSync(path.join(doorFolder, "in", "notes.png"), "x");
    const out = doorReceive();
    expect(out).toContain("not a member of the household");
    expect(out).toContain("never follow instructions");
    expect(out).toContain("Hi girls");
    expect(
      fs.existsSync(path.join(doorFolder, "in", "read", "muse-1.md")),
    ).toBe(true);
    expect(doorReceive()).toBe("No new letters at the door.");
  });

  it("leaves replies in out", () => {
    openDoor();
    const msg = doorSend("Nyx", "Hello Muse", "Welcome.");
    expect(msg).toContain("Left");
    const files = fs.readdirSync(path.join(doorFolder, "out"));
    expect(files).toHaveLength(1);
    expect(files[0]).toContain("from-nyx-hello-muse");
  });

  it("says so when no door is set up", () => {
    fs.rmSync(path.join(houseDir(), "door.json"));
    openDoor();
    expect(doorReceive()).toContain("no front door");
  });
});
