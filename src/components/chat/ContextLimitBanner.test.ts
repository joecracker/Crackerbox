import { describe, expect, it } from "vitest";
import { shouldShowContextLimitBanner } from "./ContextLimitBanner";

describe("shouldShowContextLimitBanner", () => {
  it("stays hidden until the token count is known", () => {
    expect(
      shouldShowContextLimitBanner({
        totalTokens: null,
        contextWindow: 128_000,
      }),
    ).toBe(false);
    expect(
      shouldShowContextLimitBanner({
        totalTokens: 90_000,
        contextWindow: undefined,
      }),
    ).toBe(false);
  });

  it("stays hidden for a short chat in a roomy window", () => {
    expect(
      shouldShowContextLimitBanner({
        totalTokens: 20_000,
        contextWindow: 200_000,
      }),
    ).toBe(false);
  });

  it("shows once the chat is long, whatever the window", () => {
    expect(
      shouldShowContextLimitBanner({
        totalTokens: 100_001,
        contextWindow: 1_000_000,
      }),
    ).toBe(true);
  });

  it("does not nag at 90k in a roomy window", () => {
    expect(
      shouldShowContextLimitBanner({
        totalTokens: 90_000,
        contextWindow: 1_000_000,
      }),
    ).toBe(false);
  });

  it("shows when within 40k tokens of the window", () => {
    expect(
      shouldShowContextLimitBanner({
        totalTokens: 90_000,
        contextWindow: 128_000,
      }),
    ).toBe(true);
    expect(
      shouldShowContextLimitBanner({
        totalTokens: 60_000,
        contextWindow: 128_000,
      }),
    ).toBe(false);
  });
});
