import { useQuery } from "@tanstack/react-query";
import { ipc, type VeniceBalance } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;
const STALE_TIME_MS = 60_000;

/** Remaining Venice balance. `balance` is null until a Venice key is set up. */
export function useVeniceBalance() {
  const {
    data: balance,
    isLoading,
    error,
    refetch,
  } = useQuery<VeniceBalance | null, Error>({
    queryKey: queryKeys.veniceBalance.status,
    queryFn: () => ipc.veniceBalance.getVeniceBalance(),
    refetchInterval: FIVE_MINUTES_IN_MS,
    staleTime: STALE_TIME_MS,
    retry: false,
  });

  return { balance, isLoading, error, refetch };
}
