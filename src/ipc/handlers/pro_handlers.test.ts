// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unwrapIpcEnvelope } from "@/ipc/contracts/core";
import { configureTrustedRenderer } from "@/ipc/utils/renderer_security";

const mocks = vi.hoisted(() => ({
  isTestBuild: true,
  ipcHandlers: new Map<string, (event: unknown, input: unknown) => unknown>(),
  readSettings: vi.fn(),
  fetch: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(
      (
        channel: string,
        handler: (event: unknown, input: unknown) => unknown,
      ) => {
        mocks.ipcHandlers.set(channel, handler);
      },
    ),
  },
  shell: {},
}));

vi.mock("node-fetch", () => ({ default: mocks.fetch }));

vi.mock("electron-log", () => ({
  default: { scope: () => mocks.logger },
}));

vi.mock("../../main/settings", () => ({
  readSettings: mocks.readSettings,
}));

vi.mock("../utils/telemetry", () => ({
  sendTelemetryException: vi.fn(),
}));

vi.mock("../utils/test_utils", () => ({
  get IS_TEST_BUILD() {
    return mocks.isTestBuild;
  },
}));

const { registerProHandlers } = await import("./pro_handlers");

configureTrustedRenderer({
  devServerUrl: "http://localhost:5173",
  packagedRendererUrl: "file:///app/renderer/main_window/index.html",
});
registerProHandlers();

describe("existing account budget display", () => {
  beforeEach(() => {
    mocks.isTestBuild = false;
    mocks.fetch.mockReset();
    mocks.readSettings.mockReturnValue({
      providerSettings: { auto: { apiKey: { value: "display-test-key" } } },
    });
  });
  afterEach(() => {
    mocks.isTestBuild = true;
  });
  async function budget() {
    const handler = mocks.ipcHandlers.get("get-user-budget");
    if (!handler) throw new Error("Missing budget handler");
    const frame = { url: "http://localhost:5173" };
    return unwrapIpcEnvelope(
      (await handler(
        { sender: { mainFrame: frame }, senderFrame: frame },
        undefined,
      )) as never,
    );
  }
  it("preserves the display response and user ID redaction", async () => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        usedCredits: 5,
        totalCredits: 100,
        budgetResetDate: "2026-10-01T00:00:00.000Z",
        userId: "user_12345678",
      }),
    });
    await expect(budget()).resolves.toEqual({
      usedCredits: 5,
      totalCredits: 100,
      budgetResetDate: new Date("2026-10-01T00:00:00.000Z"),
      redactedUserId: "****5678",
      isTrial: false,
    });
  });
  it("continues returning null instead of blocking on account API failure", async () => {
    mocks.fetch.mockRejectedValue(new Error("service unavailable"));
    await expect(budget()).resolves.toBeNull();
  });
});
