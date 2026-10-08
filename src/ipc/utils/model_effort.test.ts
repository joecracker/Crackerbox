import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserSettings } from "@/lib/schemas";
import { resolveDefaultModelSelection } from "./model_effort";
import { findLanguageModel } from "./findLanguageModel";

vi.mock("./findLanguageModel", () => ({
  findLanguageModel: vi.fn(),
}));

const settings = (provider: string, name: string) =>
  ({
    selectedModel: { provider, name },
    providerSettings: {},
  }) as UserSettings;

describe("resolveDefaultModelSelection", () => {
  beforeEach(() => vi.mocked(findLanguageModel).mockReset());

  it("keeps an available saved default", async () => {
    vi.mocked(findLanguageModel).mockResolvedValue({
      apiName: "model-a",
      displayName: "Model A",
      description: "",
    });

    await expect(
      resolveDefaultModelSelection(settings("provider-a", "model-a")),
    ).resolves.toMatchObject({ provider: "provider-a", name: "model-a" });
  });

  it("falls back to Auto when a saved default was removed", async () => {
    vi.mocked(findLanguageModel)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        apiName: "auto",
        displayName: "Auto",
        description: "",
      });

    await expect(
      resolveDefaultModelSelection(settings("provider-a", "removed-model")),
    ).resolves.toMatchObject({ provider: "auto", name: "auto" });
  });

  it.each(["ollama", "lmstudio"])(
    "keeps a %s default outside the cloud catalog",
    async (provider) => {
      await expect(
        resolveDefaultModelSelection(settings(provider, "local-model")),
      ).resolves.toMatchObject({ provider, name: "local-model" });
      expect(findLanguageModel).not.toHaveBeenCalled();
    },
  );
});
