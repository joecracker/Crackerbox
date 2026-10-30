import { describe, expect, it } from "vitest";
import {
  HANDOFF_START_LINE,
  buildHandoffRequest,
  handoffOpeningNote,
} from "./handoff_prompts";

describe("handoffOpeningNote", () => {
  it("replaces the start line with an instruction to open with just the question", () => {
    const note = handoffOpeningNote(HANDOFF_START_LINE);
    expect(note).toContain("[Handoff]");
    expect(note).toContain("Open with only the question");
    expect(note).toContain("no recap");
    expect(note).not.toContain(HANDOFF_START_LINE);
  });

  it("tolerates surrounding whitespace", () => {
    expect(handoffOpeningNote(`  ${HANDOFF_START_LINE}\n`)).not.toBeNull();
  });

  it("leaves ordinary messages alone", () => {
    expect(
      handoffOpeningNote("Continue from the handoff, then add a button"),
    ).toBeNull();
    expect(handoffOpeningNote("Please summarize this file")).toBeNull();
    expect(handoffOpeningNote(undefined)).toBeNull();
  });
});

describe("buildHandoffRequest", () => {
  it("asks for the handoff and nothing else", () => {
    expect(buildHandoffRequest()).toMatch(/Write the handoff/);
    expect(buildHandoffRequest()).not.toMatch(/carry this over/);
  });

  it("passes along what the user wants carried over", () => {
    const request = buildHandoffRequest("  keep the proof sheet ");
    expect(request).toContain("Please carry this over: keep the proof sheet");
  });

  it("ignores a blank note", () => {
    expect(buildHandoffRequest("   ")).toBe(buildHandoffRequest());
  });
});
