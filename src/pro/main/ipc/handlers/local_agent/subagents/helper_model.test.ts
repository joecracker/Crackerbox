import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getChatInferenceSettings: vi.fn(),
  resolveModelSelection: vi.fn(),
}));
vi.mock("@/ipc/services/chat_inference_settings", () => ({
  getChatInferenceSettings: mocks.getChatInferenceSettings,
}));
vi.mock("@/ipc/utils/model_effort", () => ({
  resolveModelSelection: mocks.resolveModelSelection,
}));

import { getHelperInference } from "./helper_model";

const chatModel = { provider: "custom::Venice AI", name: "venice-test" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getChatInferenceSettings.mockResolvedValue({
    selectedModel: chatModel,
    selectedChatMode: "local-agent",
    modelEffortPreferences: { "custom::Venice AI/venice-test": "low" },
  });
  mocks.resolveModelSelection.mockImplementation(
    async ({ model, preferredEffortLevel }) => ({
      ...model,
      effortLevel: preferredEffortLevel ?? "medium",
    }),
  );
});

describe("getHelperInference", () => {
  it("works on the model the chat is using, not a hosted one", async () => {
    const { settings, selectedModel } = await getHelperInference(5);
    expect(selectedModel).toMatchObject(chatModel);
    expect(settings.selectedModel).toBe(selectedModel);
    expect(mocks.resolveModelSelection).toHaveBeenCalledWith(
      expect.objectContaining({ model: chatModel }),
    );
  });

  it("keeps the rest of the accepted settings", async () => {
    const accepted = { selectedModel: chatModel, selectedChatMode: "ask" };
    mocks.getChatInferenceSettings.mockResolvedValueOnce(accepted);
    const { settings } = await getHelperInference(5, accepted as never);
    expect(mocks.getChatInferenceSettings).toHaveBeenCalledWith(5, accepted);
    expect(settings.selectedChatMode).toBe("ask");
  });
});
