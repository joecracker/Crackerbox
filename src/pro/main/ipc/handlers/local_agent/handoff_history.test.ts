import { describe, expect, it } from "vitest";
import { buildChatMessageHistory } from "./local_agent_handler";

function row(
  id: number,
  role: "user" | "assistant",
  content: string,
): Parameters<typeof buildChatMessageHistory>[0][number] {
  return {
    id,
    role,
    content,
    aiMessagesJson: null,
    sourceCommitHash: null,
    commitHash: null,
    isCompactionSummary: false,
    model: null,
    inferenceSource: null,
    createdAt: new Date(2026, 9, 3, 10, id),
  } as unknown as Parameters<typeof buildChatMessageHistory>[0][number];
}

const SUMMARY = `## What was done
- Built the how-to slideshow

## Current state
- It runs and fits one screen

## Open problems
- None

## Parked ideas (NOT started)
- A bigger picture

## Relevant files
- \`tools/howto.mjs\` - the builder`;

function textOf(message: { content: unknown }): string {
  return typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
}

describe("buildChatMessageHistory for a handoff chat", () => {
  it("shows the model a background note instead of a request to summarize", () => {
    const history = buildChatMessageHistory([
      row(1, "user", "Summarize from chat-id=46"),
      row(2, "assistant", SUMMARY),
      row(3, "user", "It is way too tall on my phone."),
    ]);

    expect(history).toHaveLength(3);
    expect(history[0].role).toBe("user");
    expect(textOf(history[0])).toContain("[Handoff] Chat 46");
    expect(textOf(history[0])).toContain("NOT asked for a recap");
    expect(textOf(history[0])).not.toContain("Summarize from chat-id");
  });

  it("keeps the summary and the user's real message exactly as written", () => {
    const history = buildChatMessageHistory([
      row(1, "user", "Summarize from chat-id=46"),
      row(2, "assistant", SUMMARY),
      row(3, "user", "It is way too tall on my phone."),
    ]);

    expect(textOf(history[1])).toContain("## What was done");
    expect(textOf(history[2])).toBe("It is way too tall on my phone.");
  });

  it("does not rewrite ordinary messages", () => {
    const history = buildChatMessageHistory([
      row(1, "user", "Please summarize this file"),
      row(2, "assistant", "Sure, here it is."),
    ]);

    expect(textOf(history[0])).toBe("Please summarize this file");
    expect(textOf(history[0])).not.toContain("[Handoff]");
  });
});
