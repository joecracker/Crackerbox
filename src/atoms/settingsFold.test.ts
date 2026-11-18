// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import {
  isSettingsSectionOpen,
  resetSettingsOpenSectionsAtom,
  setSettingsSectionOpenAtom,
  settingsOpenSectionsAtom,
} from "./viewAtoms";

describe("settings sections start folded", () => {
  it("starts with nothing open, opens one on request, and folds all again", () => {
    const store = createStore();
    expect(
      isSettingsSectionOpen(store.get(settingsOpenSectionsAtom), "voice"),
    ).toBe(false);
    store.set(setSettingsSectionOpenAtom, { id: "voice", open: true });
    expect(
      isSettingsSectionOpen(store.get(settingsOpenSectionsAtom), "voice"),
    ).toBe(true);
    expect(
      isSettingsSectionOpen(store.get(settingsOpenSectionsAtom), "ai"),
    ).toBe(false);
    store.set(resetSettingsOpenSectionsAtom);
    expect(
      isSettingsSectionOpen(store.get(settingsOpenSectionsAtom), "voice"),
    ).toBe(false);
  });
});
