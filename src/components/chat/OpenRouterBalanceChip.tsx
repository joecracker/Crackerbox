import { useEffect, useRef } from "react";
import { useOpenRouterBalance } from "@/hooks/useOpenRouterBalance";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * Small "$12.40 left" chip for the chat header. Display only: it never limits,
 * pauses, or changes anything. Shows nothing until a management key is saved.
 */
export function OpenRouterBalanceChip({
  isStreaming,
}: {
  isStreaming: boolean;
}) {
  const { balance, isLoading, error, refetch } = useOpenRouterBalance();

  // Refresh once each reply finishes, so the number moves as you spend.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !isStreaming) void refetch();
    wasStreaming.current = isStreaming;
  }, [isStreaming, refetch]);

  if (isLoading || (!balance && !error)) return null;

  const label = balance ? `${usd.format(balance.remaining)} left` : "$ ?";
  const detail = balance
    ? `Spent ${usd.format(balance.totalUsage)} of ${usd.format(balance.totalCredits)} purchased`
    : (error?.message ?? "Balance unavailable");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              data-testid="openrouter-balance-chip"
              className="mr-1 cursor-default rounded-md px-2 py-1 text-xs tabular-nums text-muted-foreground hover:bg-(--background-lightest)"
            />
          }
        >
          {label}
        </TooltipTrigger>
        <TooltipContent>{detail}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
