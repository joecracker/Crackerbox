import { getChatInferenceSettings } from "@/ipc/services/chat_inference_settings";
import { resolveModelSelection } from "@/ipc/utils/model_effort";
import { getModelPreferenceKey } from "@/lib/modelEffort";
import type { UserSettings } from "@/lib/schemas";

/**
 * Helper agents (explorer, reviewer, implementer) work on the model the chat is
 * already using, with the effort the user set for it. They are not tied to any
 * hosted model, so they need no Dyad service or key.
 */
export async function getHelperInference(
  chatId: number,
  acceptedSettings?: UserSettings,
) {
  const stored = await getChatInferenceSettings(chatId, acceptedSettings);
  const selectedModel = await resolveModelSelection({
    model: stored.selectedModel,
    preferredEffortLevel:
      stored.modelEffortPreferences?.[
        getModelPreferenceKey(stored.selectedModel)
      ],
  });
  return { settings: { ...stored, selectedModel }, selectedModel };
}
