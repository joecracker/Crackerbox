import { describe, expect, it } from "vitest";
import {
  describeCurrentAction,
  isWorkInProgress,
  splitReply,
  spokenTextForReply,
} from "./replySummary";
import { stripSpokenNoise } from "./speechText";

const READ = '<dyad-read path="src/a.ts"></dyad-read>';
const THINK = "<think>Let me look at the file first.</think>";

describe("splitReply", () => {
  it("folds narration, thinking and steps before her final message", () => {
    const content = `${THINK}Let me read the file. ${READ}Now the other one. ${READ}All done. The page works now.`;
    const split = splitReply(content);

    expect(split).not.toBeNull();
    expect(split?.summary).toBe("All done. The page works now.");
    expect(split?.steps).toBe(2);
    expect(content.startsWith(split!.work)).toBe(true);
    expect(split!.work).toContain("Let me read the file.");
    expect(split!.work).not.toContain("All done.");
  });

  it("shows a reply as it is when it has no steps", () => {
    expect(splitReply("Just a plain answer with **bold** text.")).toBeNull();
  });

  it("folds a reply that ends on a step and leaves nothing else showing", () => {
    const split = splitReply(`Reading now. ${READ}`);
    expect(split?.summary).toBe("");
    expect(split?.steps).toBe(1);
  });

  it("never folds a reply that has something you need to act on", () => {
    const questionnaire =
      '<dyad-questionnaire title="Pick one"></dyad-questionnaire>';
    // After her last step, anything that needs you stays visible next to her
    // message while the steps before it fold away.
    const asked = splitReply(`${READ}${questionnaire}Here you go.`);
    expect(asked?.work).toBe(READ);
    expect(asked?.summary).toContain("dyad-questionnaire");
    expect(asked?.summary).toContain("Here you go.");
    const paused = splitReply(
      `${READ}<dyad-step-limit>Automatically paused after 40 tool calls.</dyad-step-limit>Want me to continue?`,
    );
    expect(paused?.summary).toContain("dyad-step-limit");
    expect(paused?.summary).toContain("Want me to continue?");
    const rebuild = splitReply(
      `${READ}<dyad-command type="rebuild"></dyad-command>Rebuild when ready.`,
    );
    expect(rebuild?.summary).toContain("dyad-command");
    // Something that needs you in the middle of her working is never hidden.
    expect(splitReply(`${READ}${questionnaire}${READ}All done.`)).toBeNull();
  });

  it("folds a failed tool she worked past", () => {
    const error =
      '<dyad-output type="error" message="Tool grep failed">x</dyad-output>';
    const split = splitReply(`${READ}${error}${READ}Done.`);
    expect(split?.summary).toBe("Done.");
  });

  it("keeps error reports visible", () => {
    const error =
      '<dyad-output type="error" message="Build failed">details</dyad-output>';
    const failed = splitReply(`${READ}${error}It failed.`);
    expect(failed?.work).toBe(READ);
    expect(failed?.summary).toContain("Build failed");
    expect(failed?.summary).toContain("It failed.");
    const warning =
      '<dyad-output type="warning" message="Careful">details</dyad-output>';
    expect(splitReply(`${READ}${warning}Mostly fine.`)?.summary).toBe(
      "Mostly fine.",
    );
  });

  it("leaves a reply alone while a step is still open", () => {
    expect(splitReply('<dyad-read path="src/a.ts">partial')).toBeNull();
  });

  it("folds thinking on its own and labels it as thinking", () => {
    const split = splitReply(`${THINK}Here is the answer.`);
    expect(split?.summary).toBe("Here is the answer.");
    expect(split?.steps).toBe(0);
  });
});

describe("isWorkInProgress", () => {
  it("is true once she has started working and nothing needs you", () => {
    expect(isWorkInProgress(`Let me look. ${READ}`)).toBe(true);
    expect(isWorkInProgress('<dyad-read path="src/a.ts">partial')).toBe(true);
  });

  it("is false for a plain streaming answer", () => {
    expect(isWorkInProgress("Here is part of an answer")).toBe(false);
  });

  it("is false when something needs your attention", () => {
    expect(
      isWorkInProgress(
        `${READ}<dyad-questionnaire title="Pick one"></dyad-questionnaire>`,
      ),
    ).toBe(false);
  });
});

describe("spokenTextForReply", () => {
  const content = `${THINK}Reading src/components/ModelPicker.tsx now. ${READ}Edited src/components/ModelPicker.tsx and pushed 3be57cb8 to https://github.com/joecracker/Crackerbox. The model picker is fixed.`;

  it("reads only her final message in Summary view, without links or paths", () => {
    expect(spokenTextForReply(content, true)).toBe(
      "Edited a file and pushed to a link. The model picker is fixed.",
    );
  });

  it("reads everything when Summary view is off", () => {
    const spoken = spokenTextForReply(content, false);
    expect(spoken).toContain("Reading a file now.");
    expect(spoken).toContain("The model picker is fixed.");
  });

  it("reads a reply with nothing to fold in full", () => {
    expect(spokenTextForReply("It is done. Anything else?", true)).toBe(
      "It is done. Anything else?",
    );
  });
});

describe("stripSpokenNoise", () => {
  it("replaces web addresses, file paths and commit codes", () => {
    expect(stripSpokenNoise("See https://example.com/a?b=1 for more.")).toBe(
      "See a link for more.",
    );
    expect(
      stripSpokenNoise("Open C:\\Users\\user\\Documents\\notes.txt now."),
    ).toBe("Open a file now.");
    expect(stripSpokenNoise("Changed src/lib/speechText.ts today.")).toBe(
      "Changed a file today.",
    );
    expect(stripSpokenNoise("Changed lib/speechText.ts today.")).toBe(
      "Changed a file today.",
    );
    expect(stripSpokenNoise("Pushed commit a496028c to main.")).toBe(
      "Pushed commit to main.",
    );
  });

  it("leaves ordinary writing alone", () => {
    for (const text of [
      "On 10/13/2026 we shipped it.",
      "Use yes/no answers and/or short ones.",
      "It took 24/7 effort, about 3,500 characters.",
      "Version 13 has one file changed.",
      "The beadface check is deadbeef-free.",
    ]) {
      expect(stripSpokenNoise(text)).toBe(text);
    }
  });
});

describe("splitReply and the Checks note", () => {
  const NOTE = "Checks: type check passed. tests/build/pre-commit not run.";

  it("folds the app's Checks note away with her working", () => {
    const content = `${READ}All done. The page works now.\n\n${NOTE}`;
    const split = splitReply(content);

    expect(split?.summary).toBe("All done. The page works now.");
    expect(split?.work).toContain(NOTE);
    expect(spokenTextForReply(content, true)).not.toContain("Checks");
  });

  it("keeps a failed or incomplete check where you can see it", () => {
    const content = `${READ}Almost there.\n\nChecks: type check failed.`;
    expect(splitReply(content)?.summary).toContain(
      "Checks: type check failed.",
    );
  });

  it("does not fold a reply that is only the note", () => {
    const content = `${READ}\n\n${NOTE}`;
    expect(splitReply(content)?.summary).toBe(NOTE);
  });
});

describe("describeCurrentAction", () => {
  it("says in plain words what her latest step is", () => {
    expect(describeCurrentAction(`Looking. ${READ}`)).toBe("Reading a.ts");
    expect(
      describeCurrentAction(
        `${READ}<dyad-write path="app/src/Main.kt">x</dyad-write>`,
      ),
    ).toBe("Writing Main.kt");
    expect(describeCurrentAction("<think>hmm</think>")).toBe(
      "Thinking it through",
    );
    expect(describeCurrentAction("just text")).toBe("Working");
  });
});
