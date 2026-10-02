import { describe, expect, it } from "vitest";
import { getSummarizeRequestAction } from "./ContextLimitBanner";

describe("context limit summarize action", () => {
  it("runs immediately while the chat is idle", () => {
    expect(getSummarizeRequestAction(false)).toBe("run");
  });

  it("waits (does nothing) while the current response is still running", () => {
    expect(getSummarizeRequestAction(true)).toBe("wait");
  });
});