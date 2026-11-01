import { useEffect, useRef } from "react";
import { useVeniceBalance } from "@/hooks/useVeniceBalance";
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
const num = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Small "$12.40 left" chip for the chat header, showing the Venice balance that
 * is being spent next (DIEM first, then credits, then USD). Display only: it
 * never limits, pauses, or changes anything. Shows nothing until a Venice key
 * is set up.
 */
export function VeniceBalanceChip({ isStreaming }: { isStreaming: boolean }) {
  const { balance, isLoading, error, refetch } = useVeniceBalance();

  // Refresh once each reply finishes, so the number moves as you spend.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !isStreaming) void refetch();
    wasStreaming.current = isStreaming;
  }, [isStreaming, refetch]);

  if (isLoading || (!balance && !error)) return null;

  let label = "$ ?";
  let detail = error?.message ?? "Balance unavailable";
  if (balance) {
    switch (balance.consumptionCurrency) {
      case "DIEM":
        label = `${num.format(balance.diem)} DIEM left`;
        break;
      case "EARNED_CREDITS":
        label = `${usd.format(balance.earnedCredits)} left`;
        break;
      case "BUNDLED_CREDITS":
        label = `${usd.format(balance.bundledCredits)} left`;
        break;
      default:
        label = `${usd.format(balance.usd)} left`;
    }
    const parts = [
      balance.diem > 0 ? `${num.format(balance.diem)} DIEM` : null,
      balance.earnedCredits > 0
        ? `${usd.format(balance.earnedCredits)} earned credit`
        : null,
      balance.bundledCredits > 0
        ? `${usd.format(balance.bundledCredits)} bundled credit`
        : null,
      balance.usd > 0 ? `${usd.format(balance.usd)} USD credit` : null,
    ].filter(Boolean);
    detail = `Venice: ${parts.length ? parts.join(", ") : "nothing left"}. Spent in that order.`;
    if (!balance.canConsume)
      detail += " Venice says this key cannot spend right now.";
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              data-testid="venice-balance-chip"
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
