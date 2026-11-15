import { describe, expect, it, vi } from "vitest";

const roster = vi.hoisted(() => ({ list: [] as any[] }));
vi.mock("@/pro/main/ipc/handlers/local_agent/house", () => ({
  readRoster: () => roster.list,
}));

import {
  entityModelSelectionForApp,
  entityImageEngine,
  entityModelSelectionForChat,
  normalizeEntityModel,
} from "./house_temperament";

const model = {
  provider: "openrouter",
  name: "some/model",
  effortLevel: "high",
};

describe("roster model selection", () => {
  it("accepts a full selection and rejects malformed ones", () => {
    expect(normalizeEntityModel(model)).toEqual(model);
    expect(normalizeEntityModel({ provider: "x" })).toBeUndefined();
    expect(normalizeEntityModel("nope")).toBeUndefined();
    expect(normalizeEntityModel(undefined)).toBeUndefined();
  });

  it("finds the speaker's model by chat sister, else by room", () => {
    roster.list = [
      { id: "a", appId: 1, modelSelection: model },
      { id: "b", appId: 2 },
    ];
    expect(
      entityModelSelectionForChat({ sisterId: "a", app: { id: 2 } }),
    ).toEqual(model);
    expect(
      entityModelSelectionForChat({ sisterId: null, app: { id: 1 } }),
    ).toEqual(model);
    expect(
      entityModelSelectionForChat({ sisterId: "b", app: { id: 1 } }),
    ).toBeUndefined();
    expect(entityModelSelectionForApp(1)).toEqual(model);
    expect(entityModelSelectionForApp(2)).toBeUndefined();
    expect(entityModelSelectionForApp(99)).toBeUndefined();
  });

  it("changes nothing when the roster cannot be read", () => {
    roster.list = null as any;
    expect(entityModelSelectionForApp(1)).toBeUndefined();
  });
});

describe("roster image engine", () => {
  it("returns her favorite engine by sister id, else by room", () => {
    roster.list = [
      { id: "v", appId: 5, imageEngine: " siray-seedream-4-5-i2i " },
      { id: "n", appId: 6 },
    ];
    expect(entityImageEngine("v", 99)).toBe("siray-seedream-4-5-i2i");
    expect(entityImageEngine(undefined, 5)).toBe("siray-seedream-4-5-i2i");
    expect(entityImageEngine("n", 6)).toBeUndefined();
    expect(entityImageEngine(undefined, 123)).toBeUndefined();
  });
});
