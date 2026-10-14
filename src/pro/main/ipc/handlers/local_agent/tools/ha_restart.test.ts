import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ haRestFetch: vi.fn() }));

vi.mock("./ha_client", () => ({
  getHomeAssistantSettings: () => ({}),
  haRestFetch: mocks.haRestFetch,
}));

import { haRestartTool } from "./ha_restart";

const ok = (body: unknown = {}) =>
  ({ json: async () => body }) as unknown as Response;
const ctx = {} as never;

describe("ha_restart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.haRestFetch.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses to restart when the configuration check fails", async () => {
    mocks.haRestFetch.mockResolvedValueOnce(
      ok({ result: "invalid", errors: "Bad indentation in automations.yaml" }),
    );

    const result = await haRestartTool.execute({}, ctx);

    expect(result).toContain("Not restarted");
    expect(result).toContain("Bad indentation");
    expect(mocks.haRestFetch).toHaveBeenCalledTimes(1);
    expect(mocks.haRestFetch.mock.calls[0][1]).toBe(
      "/api/config/core/check_config",
    );
  });

  it("restarts after a good check and reports when it came back", async () => {
    mocks.haRestFetch
      .mockResolvedValueOnce(ok({ result: "valid", errors: null }))
      .mockResolvedValueOnce(ok())
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(ok());

    const pending = haRestartTool.execute({}, ctx);
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await pending;

    expect(mocks.haRestFetch.mock.calls[1][1]).toBe(
      "/api/services/homeassistant/restart",
    );
    expect(result).toContain("restarted");
    expect(result).toContain("answered again");
  });

  it("says so when it never saw Home Assistant go offline", async () => {
    mocks.haRestFetch
      .mockResolvedValueOnce(ok({ result: "valid", errors: null }))
      .mockResolvedValueOnce(ok())
      .mockResolvedValue(ok());

    const pending = haRestartTool.execute({}, ctx);
    await vi.advanceTimersByTimeAsync(90_000);
    const result = await pending;

    expect(result).toContain("never saw Home Assistant go offline");
  });

  it("is asked about every time and does not count as a file change", () => {
    expect(haRestartTool.defaultConsent).toBe("ask");
    expect(haRestartTool.shouldTrackMutation?.({}, "anything", ctx)).toBe(
      false,
    );
  });
});
