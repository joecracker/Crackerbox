import { useQuery } from "@tanstack/react-query";
import { ipc, type OpenRouterBalance } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;
const STALE_TIME_MS = 60_000;

/** OpenRouter credits bought vs. used. `balance` is null until a key is saved. */
export function useOpenRouterBalance() {
  const {
    data: balance,
    isLoading,
    error,
    refetch,
  } = useQuery<OpenRouterBalance | null, Error>({
    queryKey: queryKeys.openRouterBalance.status,
    queryFn: () => ipc.openRouterBalance.getOpenRouterBalance(),
    refetchInterval: FIVE_MINUTES_IN_MS,
    staleTime: STALE_TIME_MS,
    retry: false,
  });

  return { balance, isLoading, error, refetch };
}
