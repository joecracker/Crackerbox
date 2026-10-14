import { describe, expect, it } from "vitest";
import { hasSummaryChat, summaryPromptFor } from "./useChatAlreadySummarized";

describe("hasSummaryChat", () => {
  it("finds the chat that was started by summarizing this one", () => {
    const hits = [{ id: 9, matchedMessageContent: summaryPromptFor(5) }];
    expect(hasSummaryChat(hits, 5)).toBe(true);
  });

  it("is not fooled by a longer chat number", () => {
    const hits = [{ id: 9, matchedMessageContent: summaryPromptFor(51) }];
    expect(hasSummaryChat(hits, 5)).toBe(false);
  });

  it("ignores title-only matches and the chat itself", () => {
    expect(hasSummaryChat([{ id: 9, matchedMessageContent: null }], 5)).toBe(
      false,
    );
    expect(
      hasSummaryChat(
        [{ id: 5, matchedMessageContent: summaryPromptFor(5) }],
        5,
      ),
    ).toBe(false);
  });

  it("says no when nothing matched", () => {
    expect(hasSummaryChat([], 5)).toBe(false);
  });
});
