import { describe, expect, it } from "vitest";
import { repairOrphanThink } from "./think_repair";

describe("repairOrphanThink", () => {
  it("leaves text without a closer alone", () => {
    expect(repairOrphanThink("hello")).toBe("hello");
  });

  it("leaves balanced thinking alone", () => {
    const s = "<think>plan</think>\nAnswer.";
    expect(repairOrphanThink(s)).toBe(s);
  });

  it("boxes thinking that has a stray closer", () => {
    expect(
      repairOrphanThink("Let me look.\nplan plan</think>Swinging now."),
    ).toBe("<think>Let me look.\nplan plan</think>Swinging now.");
  });

  it("does not pull earlier cards inside the box", () => {
    const s =
      '<dyad-write path="a">x</dyad-write>\nthoughts here</think>\nDone.';
    expect(repairOrphanThink(s)).toBe(
      '<dyad-write path="a">x</dyad-write>\n<think>thoughts here</think>\nDone.',
    );
  });

  it("is a no-op when run twice", () => {
    const once = repairOrphanThink("a b</think>c");
    expect(repairOrphanThink(once)).toBe(once);
  });
});
