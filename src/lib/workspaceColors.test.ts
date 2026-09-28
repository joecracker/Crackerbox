import { describe, expect, it } from "vitest";
import {
  applyWorkspaceColors,
  WORKSPACE_COLOR_FIELDS,
  WORKSPACE_COLOR_PRESETS,
} from "./workspaceColors";

describe("workspace colors", () => {
  it("keeps every editable color independent", () => {
    const keys = WORKSPACE_COLOR_FIELDS.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("background");
    expect(keys).toContain("chat");
    expect(keys).toContain("wordmark");
  });

  it("applies and resets overrides", () => {
    const root = document.createElement("div");
    applyWorkspaceColors({ chat: "#123456", text: "#abcdef" }, root);
    expect(root.style.getPropertyValue("--brand-chat-canvas")).toBe("#123456");
    expect(root.style.getPropertyValue("--foreground")).toBe("#abcdef");
    expect(root.style.getPropertyValue("--sidebar-foreground")).toBe("#abcdef");

    applyWorkspaceColors({}, root);
    expect(root.style.getPropertyValue("--brand-chat-canvas")).toBe("");
    expect(root.style.getPropertyValue("--foreground")).toBe("");
  });

  it("offers complete presets", () => {
    for (const preset of Object.values(WORKSPACE_COLOR_PRESETS)) {
      for (const field of WORKSPACE_COLOR_FIELDS) {
        expect(preset[field.key]).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
