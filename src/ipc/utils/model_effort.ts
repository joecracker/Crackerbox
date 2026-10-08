import type {
  LargeLanguageModel,
  ModelSelection,
  UserSettings,
} from "@/lib/schemas";
import { createModelSelection, getModelPreferenceKey } from "@/lib/modelEffort";
import { findLanguageModel } from "./findLanguageModel";
import { modelForChatBackend } from "@/shared/execution_backend";
import { LOCAL_PROVIDERS } from "@/ipc/shared/language_model_constants";

export async function resolveModelSelection({
  model,
  preferredEffortLevel,
}: {
  model: LargeLanguageModel;
  preferredEffortLevel?: string | null;
}): Promise<ModelSelection> {
  if (model.provider === "claude-code")
    return { ...model, effortLevel: preferredEffortLevel ?? "medium" };
  const catalogModel = await findLanguageModel(model);
  return createModelSelection({
    model,
    catalogModel,
    preferredEffortLevel,
  });
}

export async function resolveDefaultModelSelection(
  settings: UserSettings,
): Promise<ModelSelection> {
  const selectedModel = modelForChatBackend(undefined, settings);
  if (selectedModel.provider in LOCAL_PROVIDERS) {
    return createModelSelection({
      model: selectedModel,
      preferredEffortLevel:
        settings.modelEffortPreferences?.[getModelPreferenceKey(selectedModel)],
    });
  }
  if (
    selectedModel.provider !== "auto" &&
    selectedModel.provider !== "claude-code" &&
    !(await findLanguageModel(selectedModel))
  ) {
    const autoModel = { provider: "auto", name: "auto" };
    return resolveModelSelection({
      model: autoModel,
      preferredEffortLevel:
        settings.modelEffortPreferences?.[getModelPreferenceKey(autoModel)],
    });
  }
  return resolveModelSelection({
    model: selectedModel,
    preferredEffortLevel:
      settings.modelEffortPreferences?.[getModelPreferenceKey(selectedModel)],
  });
}

export async function normalizeModelSelection(
  selection: ModelSelection,
): Promise<ModelSelection> {
  return resolveModelSelection({
    model: selection,
    preferredEffortLevel: selection.effortLevel,
  });
}
