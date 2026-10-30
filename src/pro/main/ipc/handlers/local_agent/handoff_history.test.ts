import { describe, expect, it } from "vitest";
import { buildChatMessageHistory } from "./local_agent_handler";
import { HANDOFF_START_LINE } from "@/prompts/handoff_prompts";

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

function textOf(message: { content: unknown }): string {
  return typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
}

describe("buildChatMessageHistory for a chat started from a handoff", () => {
  it("shows the model an opening instruction instead of the start line", () => {
    const history = buildChatMessageHistory([
      row(1, "user", HANDOFF_START_LINE),
      row(2, "assistant", "Here is the plan."),
      row(3, "user", "Do the first one."),
    ]);

    expect(history).toHaveLength(3);
    expect(history[0].role).toBe("user");
    expect(textOf(history[0])).toContain("[Handoff]");
    expect(textOf(history[0])).toContain("no recap");
    expect(textOf(history[0])).not.toContain(HANDOFF_START_LINE);
  });

  it("keeps the replies and the user's real messages exactly as written", () => {
    const history = buildChatMessageHistory([
      row(1, "user", HANDOFF_START_LINE),
      row(2, "assistant", "Here is the plan."),
      row(3, "user", "It is way too tall on my phone."),
    ]);

    expect(textOf(history[1])).toContain("Here is the plan.");
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
