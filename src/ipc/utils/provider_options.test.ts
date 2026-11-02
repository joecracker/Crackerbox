import { describe, expect, it } from "vitest";

import type { ModelSelection, UserSettings } from "@/lib/schemas";
import {
  DYAD_INTERNAL_REQUEST_ID_HEADER,
  getAiHeaders,
  getProviderOptions,
} from "./provider_options";

const settingsFor = (provider: string, name: string, effortLevel: string) =>
  ({
    selectedModel: { provider, name, effortLevel },
    selectedChatMode: "build",
  }) as unknown as UserSettings;

const optionsFor = (
  settings: UserSettings,
  builtinProviderId?: string,
  reasoningEffortProviderId?: string,
  modelSelection = settings.selectedModel as ModelSelection,
) =>
  getProviderOptions({
    dyadAppId: 1,
    files: [],
    mentionedAppsCodebases: [],
    builtinProviderId,
    reasoningEffortProviderId,
    modelSelection,
  });

describe("Venice reasoning effort", () => {
  const veniceId = "custom::Venice AI";
  const venice = (effort: string) =>
    optionsFor(
      settingsFor(veniceId, "deepseek-v4-1-flash-uncensored", effort),
      veniceId,
      veniceId,
    )[veniceId];

  it("turns the generic medium into low, which Venice lists", () => {
    expect(venice("medium")).toEqual({ reasoningEffort: "low" });
  });

  it("keeps low, high and max as chosen", () => {
    expect(venice("low")).toEqual({ reasoningEffort: "low" });
    expect(venice("high")).toEqual({ reasoningEffort: "high" });
    expect(venice("max")).toEqual({ reasoningEffort: "max" });
  });

  it("leaves other custom providers alone", () => {
    const id = "custom::Something Else";
    expect(optionsFor(settingsFor(id, "m", "medium"), id, id)[id]).toEqual({
      reasoningEffort: "medium",
    });
  });
});

describe("getProviderOptions model effort", () => {
  it("uses thinking levels for Gemini 3 direct requests", () => {
    expect(
      optionsFor(settingsFor("google", "gemini-3-pro", "minimal"), "google")
        .google,
    ).toEqual({
      thinkingConfig: { includeThoughts: true, thinkingLevel: "minimal" },
    });
  });

  it("uses thinking budgets for earlier Gemini direct requests", () => {
    expect(
      optionsFor(settingsFor("google", "gemini-2.5-pro", "high"), "google")
        .google,
    ).toEqual({
      thinkingConfig: { includeThoughts: true, thinkingBudget: -1 },
    });
  });

  it("uses the resolved Gemini model when Auto routes to Google", () => {
    expect(
      optionsFor(settingsFor("auto", "auto", "medium"), "google", undefined, {
        provider: "google",
        name: "gemini-3.5-flash",
        effortLevel: "high",
      }).google,
    ).toEqual({
      thinkingConfig: { includeThoughts: true, thinkingLevel: "high" },
    });
  });

  it("does not coerce catalog-defined Gemini effort levels to medium", () => {
    expect(
      optionsFor(settingsFor("google", "gemini-2.5-pro", "xhigh"), "google")
        .google,
    ).toEqual({ thinkingConfig: { includeThoughts: true } });
  });

  it("does not send Gemini thinking config to other Google model families", () => {
    expect(
      optionsFor(settingsFor("google", "partner/model", "medium"), "google")
        .google,
    ).toBeUndefined();
  });

  it("passes effort to OpenAI-compatible local and custom providers", () => {
    expect(
      optionsFor(
        settingsFor("ollama", "qwen3-coder:30b", "none"),
        "ollama",
        "ollama",
      ).ollama,
    ).toEqual({ reasoningEffort: "none" });
    expect(
      optionsFor(
        settingsFor("lmstudio", "local-model", "high"),
        "lmstudio",
        "lmstudio",
      ).lmstudio,
    ).toEqual({ reasoningEffort: "high" });
    expect(
      optionsFor(
        settingsFor("custom-provider", "custom-model", "low"),
        "custom-provider",
        "custom-provider",
      )["custom-provider"],
    ).toEqual({ reasoningEffort: "low" });
  });
});

describe("getAiHeaders", () => {
  it("forwards the Dyad request ID for fallback diagnostics", () => {
    expect(
      getAiHeaders({
        builtinProviderId: "dyad-engine",
        dyadRequestId: "request-123",
      }),
    ).toEqual({ [DYAD_INTERNAL_REQUEST_ID_HEADER]: "request-123" });
  });

  it("omits headers when there is no request ID", () => {
    expect(getAiHeaders({ builtinProviderId: "openai" })).toBeUndefined();
  });
});
