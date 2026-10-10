import { describe, expect, it } from "vitest";
import { speechTextFromAssistantResponse, splitSpeechText } from "./speechText";

describe("speechTextFromAssistantResponse", () => {
  it("keeps conversational prose while omitting code and tool activity", () => {
    expect(
      speechTextFromAssistantResponse(
        "# Done\n\n<think>private reasoning</think>\n\nI fixed the button.\n\n```ts\nconsole.log('hidden')\n```\n\n<dyad-tool>internal output</dyad-tool>\n\n[Open the preview](https://example.com)",
      ),
    ).toBe("Done I fixed the button. Open the preview");
  });

  it("returns an empty string for a code-only reply", () => {
    expect(speechTextFromAssistantResponse("```js\nconst x = 1;\n```")).toBe(
      "",
    );
  });

  it("does not narrate emoji", () => {
    expect(
      speechTextFromAssistantResponse("Welcome 🎸 to Crackerbox 🖤."),
    ).toBe("Welcome to Crackerbox.");
  });

  it("keeps long playback in correctly ordered sentence chunks", () => {
    expect(
      splitSpeechText("One short sentence. Two short sentences! Three?", 30),
    ).toEqual(["One short sentence.", "Two short sentences! Three?"]);
  });
});
