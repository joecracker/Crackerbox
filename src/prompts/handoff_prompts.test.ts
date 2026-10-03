import { describe, expect, it } from "vitest";
import {
  SUMMARY_REQUEST_FOOTER,
  buildSummaryRequestMessage,
  handoffNoteForSummaryRequest,
} from "./handoff_prompts";

describe("handoffNoteForSummaryRequest", () => {
  it("replaces the machinery line with a note that asks for no recap", () => {
    const note = handoffNoteForSummaryRequest("Summarize from chat-id=46");
    expect(note).toContain("Chat 46");
    expect(note).toContain("NOT asked for a recap");
    expect(note).not.toContain("Summarize from chat-id");
  });

  it("leaves a real user message alone", () => {
    expect(
      handoffNoteForSummaryRequest("Summarize this file for me"),
    ).toBeNull();
    expect(
      handoffNoteForSummaryRequest("Please Summarize from chat-id=46 now"),
    ).toBeNull();
    expect(handoffNoteForSummaryRequest("")).toBeNull();
    expect(handoffNoteForSummaryRequest(undefined)).toBeNull();
  });

  it("tolerates trailing whitespace from the stored message", () => {
    expect(
      handoffNoteForSummaryRequest("Summarize from chat-id=7\n"),
    ).toContain("Chat 7");
  });
});

describe("buildSummaryRequestMessage", () => {
  it("puts the stop-and-summarize instruction after the transcript", () => {
    const message = buildSummaryRequestMessage(
      '<message role="user">hi</message>',
    );
    expect(message.startsWith("Summarize the following chat: ")).toBe(true);
    expect(message.endsWith(SUMMARY_REQUEST_FOOTER)).toBe(true);
    expect(message.indexOf("hi</message>")).toBeLessThan(
      message.indexOf("Do not continue it"),
    );
  });
});
