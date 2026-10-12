import { useQuery } from "@tanstack/react-query";
import { ipc, type LanguageModel } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { DYAD_CLOUD_FEATURES_ENABLED } from "@/lib/proBillingFlags";

/**
 * Fetches all available language models grouped by their provider IDs.
 *
 * @returns TanStack Query result object for the language models organized by provider.
 */
export function useLanguageModelsByProviders() {
  return useQuery<Record<string, LanguageModel[]>, Error>({
    queryKey: queryKeys.languageModels.byProviders,
    queryFn: async () => {
      return ipc.languageModel.getModelsByProviders();
    },
    // Hide Dyad's own gateway models ("auto") while the cloud switch is off.
    select: (modelsByProvider) => {
      if (DYAD_CLOUD_FEATURES_ENABLED) return modelsByProvider;
      const { auto: _dyadGateway, ...rest } = modelsByProvider;
      return rest;
    },
  });
}
