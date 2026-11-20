import { describe, expect, it } from "vitest";
import {
  FALLBACK_CODEX_CLIENT_VERSION,
  getBuiltinLanguageModelCatalog,
  getCodexClientVersion,
  getThemeGenerationModelOptions,
  resolveBuiltinModelAlias,
} from "./builtin_language_model_catalog";

describe("builtin language model catalog", () => {
  it("lists the built-in providers and their models without any network call", async () => {
    const catalog = await getBuiltinLanguageModelCatalog();

    expect(catalog.providers.map((p) => p.id)).toEqual(
      expect.arrayContaining(["openai", "anthropic", "openrouter"]),
    );
    expect(catalog.modelsByProvider.openai?.length).toBeGreaterThan(0);
  });

  it("resolves a known alias and returns null for an unknown one", async () => {
    const resolved = await resolveBuiltinModelAlias("dyad/help-bot/default");
    expect(resolved?.providerId).toBeTruthy();
    expect(resolved?.apiName).toBeTruthy();

    expect(await resolveBuiltinModelAlias("dyad/does-not-exist")).toBeNull();
  });

  it("offers theme-generation choices", async () => {
    expect((await getThemeGenerationModelOptions()).length).toBeGreaterThan(0);
  });

  it("uses the pinned Codex client version", () => {
    expect(getCodexClientVersion()).toBe(FALLBACK_CODEX_CLIENT_VERSION);
  });
});
