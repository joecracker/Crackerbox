// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({ userData: "", nextAppId: 100 }));
vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => h.userData,
  getDyadAppPath: (p: string) => path.join(h.userData, "apps", p),
}));
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: () => ({ returning: async () => [{ id: h.nextAppId++ }] }),
    }),
  },
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => ({}),
  writeSettings: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info() {}, warn() {}, error() {}, debug() {} }) },
}));

import {
  readRoster,
  writeRoster,
} from "@/pro/main/ipc/handlers/local_agent/house";
import { addEntity } from "./house_entity";
import { entityTemperatureForChat } from "./house_temperament";

const rosterFile = () => path.join(h.userData, "house", "house.json");

beforeEach(() => {
  h.userData = fs.mkdtempSync(path.join(os.tmpdir(), "cb-temperament-"));
});
afterEach(() => {
  try {
    fs.rmSync(h.userData, { recursive: true, force: true });
  } catch {
    // a temp folder that cannot be removed is not a test failure
  }
});

describe("a roster written before temperament existed", () => {
  it("still loads, and its entities have no temperament", () => {
    fs.mkdirSync(path.dirname(rosterFile()), { recursive: true });
    fs.writeFileSync(
      rosterFile(),
      JSON.stringify({
        sisters: [
          { id: "nyx", name: "Nyx", appId: 1, color: "#14b8a6", initial: "N" },
          {
            id: "veritas",
            name: "Veritas",
            appId: 2,
            color: "#f97316",
            initial: "V",
            avatar: "avatars/veritas.png",
          },
        ],
      }),
    );
    const roster = readRoster();
    expect(roster.map((s) => s.id)).toEqual(["nyx", "veritas"]);
    expect(roster[0]).not.toHaveProperty("temperature");
    expect(entityTemperatureForChat({ sisterId: "nyx", app: { id: 1 } })).toBe(
      undefined,
    );
    expect(entityTemperatureForChat({ sisterId: null, app: { id: 2 } })).toBe(
      undefined,
    );
  });

  it("keeps old entries exactly as they were when a roster is written back", () => {
    const old = {
      id: "nyx",
      name: "Nyx",
      appId: 1,
      color: "#14b8a6",
      initial: "N",
    };
    writeRoster([old]);
    writeRoster([
      ...readRoster(),
      { ...old, id: "b", appId: 2, temperature: 1.3 },
    ]);
    const saved = JSON.parse(fs.readFileSync(rosterFile(), "utf8")).sisters;
    expect(saved[0]).toEqual(old);
    expect(saved[1].temperature).toBe(1.3);
  });
});

describe("entityTemperatureForChat", () => {
  beforeEach(() => {
    writeRoster([
      {
        id: "nyx",
        name: "Nyx",
        appId: 1,
        color: "#000000",
        initial: "N",
        temperature: 1.6,
      },
      {
        id: "veritas",
        name: "Veritas",
        appId: 2,
        color: "#000000",
        initial: "V",
      },
    ]);
  });

  it("uses the entity picked for the chat", () => {
    expect(entityTemperatureForChat({ sisterId: "nyx", app: { id: 99 } })).toBe(
      1.6,
    );
    expect(
      entityTemperatureForChat({ sisterId: "veritas", app: { id: 1 } }),
    ).toBeUndefined();
  });

  it("falls back to the entity whose room it is", () => {
    expect(entityTemperatureForChat({ sisterId: null, app: { id: 1 } })).toBe(
      1.6,
    );
    expect(entityTemperatureForChat({ app: { id: 1 } })).toBe(1.6);
  });

  it("is nothing in an ordinary project with no entity", () => {
    expect(
      entityTemperatureForChat({ sisterId: null, app: { id: 55 } }),
    ).toBeUndefined();
  });

  it("ignores nonsense hand-edited into the roster", () => {
    for (const bad of [9, -2, "hot", null]) {
      writeRoster([
        {
          id: "nyx",
          name: "Nyx",
          appId: 1,
          color: "#000000",
          initial: "N",
          temperature: bad as unknown as number,
        },
      ]);
      expect(
        entityTemperatureForChat({ sisterId: "nyx", app: { id: 1 } }),
      ).toBeUndefined();
    }
  });
});

describe("addEntity with a temperament", () => {
  it("stores the temperature on the new entity", async () => {
    const s = await addEntity({ name: "Wildcard", temperature: 1.6 });
    expect(s.temperature).toBe(1.6);
    expect(readRoster().find((r) => r.id === "wildcard")?.temperature).toBe(
      1.6,
    );
    expect(
      entityTemperatureForChat({ sisterId: "wildcard", app: { id: 0 } }),
    ).toBe(1.6);
  });

  it("writes no temperature at all for Default, so the roster looks as before", async () => {
    await addEntity({ name: "Plain" });
    const saved = JSON.parse(fs.readFileSync(rosterFile(), "utf8")).sisters;
    expect(saved).toHaveLength(1);
    expect(saved[0]).not.toHaveProperty("temperature");
  });

  it("leaves out a temperature that is out of range", async () => {
    await addEntity({ name: "Hot", temperature: 7 });
    expect(readRoster()[0]).not.toHaveProperty("temperature");
  });
});
