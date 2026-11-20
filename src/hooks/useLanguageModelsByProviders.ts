import { useQuery } from "@tanstack/react-query";
import { ipc, type LanguageModel } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

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
    // Hide Dyad's own gateway models ("auto"); Crackerbox does not use them.
    select: (modelsByProvider) => {
      const { auto: _dyadGateway, ...rest } = modelsByProvider;
      return rest;
    },
  });
}
