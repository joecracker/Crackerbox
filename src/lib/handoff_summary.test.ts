import { describe, expect, it } from "vitest";
import { looksLikeHandoffSummary } from "./handoff_summary";

const GOOD = `## What was done
- Fixed the splash gradient in index.html

## Current state
- The preview shows the gradient correctly

## Open problems
- None known

## Parked ideas (NOT started)
- A how-to generator

## Relevant files
- \`index.html\` - splash background`;

describe("looksLikeHandoffSummary", () => {
  it("accepts a summary with the required sections", () => {
    expect(looksLikeHandoffSummary(GOOD)).toBe(true);
  });

  it("accepts it when the model also wrote a think block first", () => {
    expect(
      looksLikeHandoffSummary(
        `<think>Let me piece this together.</think>\n${GOOD}`,
      ),
    ).toBe(true);
  });

  it("accepts bold headings instead of # headings", () => {
    const bold = GOOD.replace(/^## (.*)$/gm, "**$1**");
    expect(looksLikeHandoffSummary(bold)).toBe(true);
  });

  it("rejects the sign-off that chat 47 produced instead of a summary", () => {
    const signOff =
      "<think>Just report what I did: email sent. Keep it short.</think>\n" +
      "The handoff summary is written. Nothing further from me - the file's in your inbox, " +
      "the tool's committed and self-checking, and the only open question is what you think.";
    expect(looksLikeHandoffSummary(signOff)).toBe(false);
  });

  it("rejects empty, short and heading-less text", () => {
    expect(looksLikeHandoffSummary("")).toBe(false);
    expect(looksLikeHandoffSummary(undefined)).toBe(false);
    expect(looksLikeHandoffSummary("## What was done\n- x")).toBe(false);
    expect(looksLikeHandoffSummary("a".repeat(500))).toBe(false);
  });

  it("does not count a heading name mentioned mid-sentence", () => {
    const prose =
      "I could write about what was done, the current state and the open problems " +
      "but I am just chatting here and not writing any structured sections at all.";
    expect(looksLikeHandoffSummary(prose)).toBe(false);
  });
});
