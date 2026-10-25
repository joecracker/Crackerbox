import { useEffect, useMemo, useState } from "react";
import { describeCurrentAction } from "@/lib/replySummary";

function formatElapsed(seconds: number) {
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * The single line shown while she works: what she is doing right now and how
 * long it has been. Her steps stay out of sight until she is done.
 */
export function LiveActionLine({ content }: { content: string }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  const label = useMemo(() => describeCurrentAction(content), [content]);

  return (
    <div
      data-testid="live-action"
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 py-2 text-sm text-muted-foreground"
    >
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400"
            style={{ animationDelay: `${dot * 200}ms` }}
          />
        ))}
      </span>
      <span className="truncate">{label}</span>
      <span className="text-xs tabular-nums opacity-70">
        {formatElapsed(seconds)}
      </span>
    </div>
  );
}
