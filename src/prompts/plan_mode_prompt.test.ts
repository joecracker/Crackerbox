import { describe, expect, it } from "vitest";
import { constructPlanModePrompt } from "./plan_mode_prompt";

describe("constructPlanModePrompt", () => {
  // Crackerbox asks planning questions one at a time, in plain chat (changed in
  // "Polish Crackerbox chat, mobile, and model workflows"). The original
  // wording allowed up to 5 per round through a multiple-choice tool.
  it("asks one focused clarification question at a time, only when needed", () => {
    const prompt = constructPlanModePrompt(undefined);

    expect(prompt).toContain("Ask one focused question at a time");
    expect(prompt).toContain(
      "only when it is needed to resolve meaningful ambiguity",
    );
    expect(prompt).not.toContain("Ask up to 5 focused questions");
    expect(prompt).not.toContain("Ask 1-3 focused questions");
  });
});
