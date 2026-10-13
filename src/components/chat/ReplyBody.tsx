import { useMemo } from "react";
import { isWorkInProgress, splitReply } from "@/lib/replySummary";
import { DyadMarkdownParser } from "./DyadMarkdownParser";
import { StreamingLoadingAnimation } from "./StreamingLoadingAnimation";

interface ReplyBodyProps {
  content: string;
  messageId: number;
  summaryView: boolean;
  isLastMessage: boolean;
  isStreaming: boolean;
}

/**
 * The body of one assistant reply. With Summary view on, a finished reply shows
 * only her final message and folds her working under "Show work", and a reply
 * that is still being worked on shows just the working indicator.
 */
export function ReplyBody({
  content,
  messageId,
  summaryView,
  isLastMessage,
  isStreaming,
}: ReplyBodyProps) {
  const live = isLastMessage && isStreaming;
  const split = useMemo(
    () => (summaryView && !live ? splitReply(content) : null),
    [summaryView, live, content],
  );
  const working = useMemo(
    () => summaryView && live && isWorkInProgress(content),
    [summaryView, live, content],
  );

  if (split) {
    const label =
      split.steps > 0
        ? `Show work (${split.steps} ${split.steps === 1 ? "step" : "steps"})`
        : "Show thinking";
    return (
      <>
        <details className="mb-2 rounded-md border border-border/60 bg-muted/30 px-3 py-1.5">
          <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
            {label}
          </summary>
          <div className="mt-2">
            <DyadMarkdownParser
              content={split.work}
              messageId={messageId}
              showStreamingPreview={false}
            />
          </div>
        </details>
        <DyadMarkdownParser
          content={split.summary}
          messageId={messageId}
          showStreamingPreview={false}
        />
      </>
    );
  }

  return (
    <>
      {!working && (
        <DyadMarkdownParser
          content={content}
          messageId={messageId}
          showStreamingPreview={live}
        />
      )}
      {live && <StreamingLoadingAnimation variant="streaming" />}
    </>
  );
}
