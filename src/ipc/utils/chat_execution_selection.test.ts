import { expect, it, vi } from "vitest";
vi.mock("@/main/settings", () => ({ readSettings: vi.fn() }));
const { findLanguageModel } = vi.hoisted(() => ({
  findLanguageModel: vi.fn(),
}));
vi.mock("./findLanguageModel", () => ({
  findLanguageModel,
}));
import type { UserSettings } from "@/lib/schemas";
import { initialChatExecution } from "./chat_execution_selection";

it("snapshots the current default into every new chat", async () => {
  findLanguageModel.mockResolvedValue({
    apiName: "model-a",
    displayName: "Model A",
    description: "",
  });
  const settings = {
    selectedModel: { provider: "provider-a", name: "model-a" },
  } as UserSettings;

  expect(await initialChatExecution(undefined, settings)).toMatchObject({
    executionBackend: "dyad",
    modelSelection: { provider: "provider-a", name: "model-a" },
  });

  settings.selectedModel = { provider: "provider-b", name: "model-b" };
  expect(await initialChatExecution(undefined, settings)).toMatchObject({
    modelSelection: { provider: "provider-b", name: "model-b" },
  });
});

it("does not pin initial created/imported chats to a disabled remembered Claude model", async () => {
  findLanguageModel.mockImplementation(async (model) =>
    model.provider === "openai"
      ? { apiName: model.name, displayName: model.name, description: "" }
      : undefined,
  );
  const settings = {
    selectedModel: { provider: "claude-code", name: "sonnet" },
    enableClaudeCodeSubscription: false,
    recentModels: [{ provider: "openai", name: "gpt-5" }],
  } as UserSettings;
  expect(await initialChatExecution(undefined, settings)).toMatchObject({
    executionBackend: "dyad",
    modelSelection: { provider: "openai", name: "gpt-5" },
  });
  expect(
    await initialChatExecution(undefined, { ...settings, recentModels: [] }),
  ).toMatchObject({
    executionBackend: "dyad",
    modelSelection: { provider: "auto", name: "auto" },
  });
  expect(
    await initialChatExecution(undefined, {
      ...settings,
      enableClaudeCodeSubscription: true,
    }),
  ).toMatchObject({
    executionBackend: "claude-code",
    modelSelection: { provider: "claude-code", name: "sonnet" },
  });
});
