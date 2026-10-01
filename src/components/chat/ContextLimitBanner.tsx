import { AlertTriangle, ArrowRight, Clock3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSummarizeInNewChat } from "./SummarizeInNewChatButton";

const CONTEXT_LIMIT_THRESHOLD = 40_000;
const LONG_CONTEXT_THRESHOLD = 200_000;

interface ContextLimitBannerProps {
  totalTokens?: number | null;
  contextWindow?: number;
  isStreaming?: boolean;
}

export function getSummarizeRequestAction(
  isStreaming: boolean,
): "queue" | "run" {
  return isStreaming ? "queue" : "run";
}

/** Check if the context limit banner should be shown */
export function shouldShowContextLimitBanner({
  totalTokens,
  contextWindow,
}: ContextLimitBannerProps): boolean {
  if (!totalTokens || !contextWindow) {
    return false;
  }
  // Show if long context (costs extra)
  if (totalTokens > LONG_CONTEXT_THRESHOLD) {
    return true;
  }
  // Show if close to context limit
  const tokensRemaining = contextWindow - totalTokens;
  return tokensRemaining <= CONTEXT_LIMIT_THRESHOLD;
}

export function ContextLimitBanner({
  totalTokens,
  contextWindow,
  isStreaming = false,
}: ContextLimitBannerProps) {
  const { handleSummarize } = useSummarizeInNewChat();
  const [isQueued, setIsQueued] = useState(false);
  const queuedRef = useRef(false);

  const requestSummarize = () => {
    if (getSummarizeRequestAction(isStreaming) === "queue") {
      queuedRef.current = true;
      setIsQueued(true);
      return;
    }
    void handleSummarize();
  };

  useEffect(() => {
    if (isStreaming || !queuedRef.current) return;
    queuedRef.current = false;
    setIsQueued(false);
    void handleSummarize();
  }, [handleSummarize, isStreaming]);

  if (!shouldShowContextLimitBanner({ totalTokens, contextWindow })) {
    return null;
  }

  const tokensRemaining = contextWindow! - totalTokens!;
  const isNearLimit = tokensRemaining <= CONTEXT_LIMIT_THRESHOLD;
  const message = isNearLimit
    ? "This chat context is running out"
    : "Long chat context costs extra";

  return (
    <div
      className="mx-auto max-w-3xl px-3 py-1.5 rounded-t-2xl border-t border-l border-r border-amber-500/30 bg-amber-500/10 flex items-center justify-between gap-3 text-xs text-amber-600 dark:text-amber-500"
      data-testid="context-limit-banner"
    >
      <span className="flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span>{message}</span>
      </span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              onClick={requestSummarize}
              disabled={isQueued}
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-500 hover:bg-amber-500/20 hover:border-amber-500/60"
            />
          }
        >
          {isQueued ? "Queued" : "Summarize"}
          {isQueued ? (
            <Clock3 className="h-3 w-3 ml-1" />
          ) : (
            <ArrowRight className="h-3 w-3 ml-1" />
          )}
        </TooltipTrigger>
        <TooltipContent>
          {isQueued
            ? "Will summarize when the current response finishes"
            : isStreaming
              ? "Queue a summary for when the current response finishes"
              : "Summarize to new chat"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
