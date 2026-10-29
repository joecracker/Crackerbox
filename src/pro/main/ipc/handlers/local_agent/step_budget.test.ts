import { describe, it, expect } from "vitest";
import { stepBudgetNote } from "./step_budget";

describe("stepBudgetNote", () => {
  it("is silent early", () => {
    expect(stepBudgetNote(0, 40)).toBeUndefined();
    expect(stepBudgetNote(19, 40)).toBeUndefined();
  });
  it("nudges past halfway, warns at 25% left, says stop at 10% left", () => {
    expect(stepBudgetNote(20, 40)).toMatch(/halfway/);
    expect(stepBudgetNote(30, 40)).toMatch(/only about 10/);
    expect(stepBudgetNote(36, 40)).toMatch(/Stop investigating/);
  });
  it("keeps the same text between milestones", () => {
    expect(stepBudgetNote(21, 40)).toBe(stepBudgetNote(29, 40));
  });
  it("ignores tiny limits", () => {
    expect(stepBudgetNote(3, 5)).toBeUndefined();
  });
});
