import { describe, expect, it } from "vitest";
import {
  speechTextFromAssistantResponse,
  splitSpeechIntoChunks,
  splitSpeechText,
} from "./speechText";

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

  it("can start with a shorter first chunk so speech begins sooner", () => {
    expect(
      splitSpeechText(
        "First sentence here. Second sentence here. Third sentence here.",
        60,
        20,
      ),
    ).toEqual([
      "First sentence here.",
      "Second sentence here. Third sentence here.",
    ]);
  });
});

describe("splitSpeechIntoChunks", () => {
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

  it("fills the first chunk when a short sentence is followed by a long one", () => {
    // From a real reply: a 31-character sentence, then a 105-character one.
    const short = "Hey, I looked at it already.";
    const long =
      "The page is published to your box, verified byte for byte, and the sliders are wired in properly.";
    const [first, second] = splitSpeechIntoChunks(`${short} ${long} More.`);

    expect(first.length).toBeGreaterThan(60);
    expect(first.length).toBeLessThanOrEqual(90);
    expect(first.startsWith(short)).toBe(true);
    // The long sentence is cut at a comma, not in the middle of a phrase.
    expect(first.endsWith(",")).toBe(true);
    expect(second.length).toBeLessThanOrEqual(83);
  });

  it("never makes a chunk bigger than the one before it until the minimum size", () => {
    const text = Array.from(
      { length: 30 },
      (_, i) => `Item ${i + 1} is a perfectly ordinary sentence about nothing.`,
    ).join(" ");
    const chunks = splitSpeechIntoChunks(text);

    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].length).toBeLessThanOrEqual(
        Math.max(70, chunks[i - 1].length),
      );
    }
    expect(chunks[0].length).toBeLessThanOrEqual(90);
  });

  it("keeps every word in order", () => {
    const text =
      "One short one. Then a much longer sentence, with several clauses, that keeps going well past the size limit of any chunk, until it finally stops. Done!";
    expect(normalize(splitSpeechIntoChunks(text).join(" "))).toBe(
      normalize(text),
    );
  });

  it("keeps whole sentences together when they fit", () => {
    expect(
      splitSpeechIntoChunks("First sentence here. Second sentence here."),
    ).toEqual(["First sentence here. Second sentence here."]);
  });

  it("cuts a long unbroken word run instead of looping forever", () => {
    const chunks = splitSpeechIntoChunks("x".repeat(400));
    expect(chunks.join("")).toBe("x".repeat(400));
    expect(
      Math.max(...chunks.map((chunk) => chunk.length)),
    ).toBeLessThanOrEqual(90);
  });

  it("returns nothing for empty text", () => {
    expect(splitSpeechIntoChunks("   ")).toEqual([]);
  });
});
