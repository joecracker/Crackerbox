// Tells CB how much of her step budget is left, at a few fixed milestones.
// The text only changes at a milestone, so it is added to the conversation
// just a few times per turn. stepNumber is 0-based: steps already done.
export function stepBudgetNote(
  stepNumber: number,
  maxSteps: number,
): string | undefined {
  if (!Number.isFinite(maxSteps) || maxSteps < 8) return undefined;
  const left = maxSteps - stepNumber;
  if (left <= Math.ceil(maxSteps * 0.1)) {
    return `STEP BUDGET: about ${Math.max(left, 1)} steps are left in this turn. Stop investigating now. Do not start anything new. Write up what you found, what you ruled out, what is still unknown and the best next step, so the work can continue cleanly in the next message.`;
  }
  if (left <= Math.ceil(maxSteps * 0.25)) {
    return `STEP BUDGET: ${maxSteps} steps per turn and only about ${left} are left. Do not open new lines of investigation. Finish what you are on, then report what you found, what you ruled out and what remains.`;
  }
  if (stepNumber >= Math.ceil(maxSteps * 0.5)) {
    return `STEP BUDGET: you are past the halfway point of ${maxSteps} steps per turn. Before searching again, check whether you already know enough to act or conclude, and batch independent lookups into a single step.`;
  }
  return undefined;
}
