import { describe, expect, it } from "vitest";
import { BUILD_IT_PROMPT, shouldOfferBuild } from "./buildOffer";

const idle = {
  isStreaming: false,
  hasComposerPayload: false,
  hasPendingConsent: false,
  hasProposal: false,
  hasQueuedMessages: false,
  isEditingQueuedMessage: false,
};
const talk = { role: "assistant" as const, content: "Here is the plan." };

describe("shouldOfferBuild", () => {
  it("offers Build after a reply that only talked", () => {
    expect(shouldOfferBuild({ ...idle, lastMessage: talk })).toBe(true);
  });

  it("does not offer it after a reply that changed files", () => {
    expect(
      shouldOfferBuild({
        ...idle,
        lastMessage: {
          role: "assistant",
          content: 'Done. <dyad-write path="a.html">x</dyad-write>',
        },
      }),
    ).toBe(false);
    expect(
      shouldOfferBuild({
        ...idle,
        lastMessage: { ...talk, commitHash: "abc123" },
      }),
    ).toBe(false);
  });

  it("still offers it after a reply that only read files", () => {
    expect(
      shouldOfferBuild({
        ...idle,
        lastMessage: {
          role: "assistant",
          content:
            '<dyad-grep query="token" count="1">a</dyad-grep> Looks fine.',
        },
      }),
    ).toBe(true);
  });

  it("stays out of the way while anything else needs attention", () => {
    for (const busy of [
      { isStreaming: true },
      { hasComposerPayload: true },
      { hasPendingConsent: true },
      { hasProposal: true },
      { hasQueuedMessages: true },
      { isEditingQueuedMessage: true },
    ]) {
      expect(shouldOfferBuild({ ...idle, ...busy, lastMessage: talk })).toBe(
        false,
      );
    }
  });

  it("does not offer it after the person's own message, or an empty reply", () => {
    expect(
      shouldOfferBuild({
        ...idle,
        lastMessage: { role: "user", content: "hello" },
      }),
    ).toBe(false);
    expect(
      shouldOfferBuild({
        ...idle,
        lastMessage: { role: "assistant", content: "  " },
      }),
    ).toBe(false);
    expect(shouldOfferBuild({ ...idle, lastMessage: undefined })).toBe(false);
  });

  it("sends a plain, readable message", () => {
    expect(BUILD_IT_PROMPT).toBe("Go ahead and build that.");
  });
});
