import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const settingsMock = vi.hoisted(() => ({ readSettings: vi.fn() }));
vi.mock("@/main/settings", () => settingsMock);

import {
  normalizeLmStudioUrl,
  getConfiguredOllamaHost,
  getConfiguredLmStudioUrl,
} from "./local_ai_hosts";
import { getLmStudioBaseUrl } from "./lm_studio_utils";

describe("normalizeLmStudioUrl", () => {
  it("fills in the protocol and the default port", () => {
    expect(normalizeLmStudioUrl("192.168.1.50")).toBe(
      "http://192.168.1.50:1234",
    );
  });
  it("keeps a port the user typed", () => {
    expect(normalizeLmStudioUrl("192.168.1.50:5000")).toBe(
      "http://192.168.1.50:5000",
    );
  });
  it("drops a trailing slash and /v1", () => {
    expect(normalizeLmStudioUrl("http://box.local:1234/v1/")).toBe(
      "http://box.local:1234",
    );
  });
  it("returns nothing for blank or nonsense input", () => {
    expect(normalizeLmStudioUrl("   ")).toBeUndefined();
    expect(normalizeLmStudioUrl(undefined)).toBeUndefined();
    expect(normalizeLmStudioUrl("http://")).toBeUndefined();
  });
});

describe("addresses typed in Settings", () => {
  const saved = process.env.LM_STUDIO_BASE_URL_FOR_TESTING;
  beforeEach(() => {
    delete process.env.LM_STUDIO_BASE_URL_FOR_TESTING;
    settingsMock.readSettings.mockReset();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.LM_STUDIO_BASE_URL_FOR_TESTING;
    else process.env.LM_STUDIO_BASE_URL_FOR_TESTING = saved;
  });

  it("uses this computer when nothing is typed", () => {
    settingsMock.readSettings.mockReturnValue({});
    expect(getConfiguredOllamaHost()).toBeUndefined();
    expect(getConfiguredLmStudioUrl()).toBeUndefined();
    expect(getLmStudioBaseUrl()).toBe("http://localhost:1234");
  });

  it("uses the typed addresses", () => {
    settingsMock.readSettings.mockReturnValue({
      localAi: { ollamaHost: " 10.0.0.7 ", lmStudioUrl: "10.0.0.8" },
    });
    expect(getConfiguredOllamaHost()).toBe("10.0.0.7");
    expect(getConfiguredLmStudioUrl()).toBe("http://10.0.0.8:1234");
    expect(getLmStudioBaseUrl()).toBe("http://10.0.0.8:1234");
  });

  it("falls back quietly if settings cannot be read", () => {
    settingsMock.readSettings.mockImplementation(() => {
      throw new Error("no settings yet");
    });
    expect(getConfiguredOllamaHost()).toBeUndefined();
    expect(getLmStudioBaseUrl()).toBe("http://localhost:1234");
  });
});
