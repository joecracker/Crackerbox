import { Activity, AlertCircle, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  DyadCard,
  DyadCardContent,
  DyadCardHeader,
  DyadCardPresentationContext,
  DyadExpandIcon,
} from "./DyadCardPrimitives";

export type ActivityGroupState =
  | "running"
  | "failed"
  | "retried"
  | "interrupted"
  | "finished";

export type ActivityKind =
  | "files"
  | "search"
  | "command"
  | "web"
  | "database"
  | "git"
  | "homeAssistant"
  | "other";

const ACTIVITY_KINDS: ActivityKind[] = [
  "files",
  "search",
  "command",
  "web",
  "database",
  "git",
  "homeAssistant",
  "other",
];

interface DyadActivityGroupProps {
  kinds: ActivityKind[];
  state: ActivityGroupState;
  children: React.ReactNode;
}

export function DyadActivityGroup({
  kinds,
  state,
  children,
}: DyadActivityGroupProps) {
  const { t } = useTranslation("chat");
  const [isExpanded, setIsExpanded] = useState(false);
  const accentColor =
    state === "failed" || state === "interrupted"
      ? "red"
      : state === "retried" || state === "running"
        ? "amber"
        : "slate";
  const icon =
    state === "running" ? (
      <Loader2 size={15} className="animate-spin" />
    ) : state === "failed" || state === "interrupted" ? (
      <AlertCircle size={15} />
    ) : state === "retried" ? (
      <RotateCcw size={15} />
    ) : (
      <Activity size={15} />
    );
  const marker =
    state === "failed"
      ? t("activity.failed")
      : state === "retried"
        ? t("activity.retried")
        : state === "interrupted"
          ? t("activity.interrupted")
          : state === "running"
            ? t("activity.running")
            : null;
  const counts = kinds.reduce<Partial<Record<ActivityKind, number>>>(
    (result, kind) => {
      result[kind] = (result[kind] ?? 0) + 1;
      return result;
    },
    {},
  );
  const summary = ACTIVITY_KINDS.filter((kind) => counts[kind])
    .map((kind) => t(`activity.kinds.${kind}`, { count: counts[kind] }))
    .join(" · ");
  const displaySummary = summary || t("activity.title");

  return (
    <DyadCard
      accentColor={accentColor}
      showAccent={state !== "finished"}
      onClick={() => setIsExpanded((value) => !value)}
      isExpanded={isExpanded}
      data-testid="dyad-activity-group"
    >
      <DyadCardHeader icon={icon} accentColor={accentColor}>
        <span className="min-w-0 truncate text-sm font-medium">
          {displaySummary}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {marker && (
            <span
              className={`text-xs font-medium ${
                state === "failed" || state === "interrupted"
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {marker}
            </span>
          )}
          <DyadExpandIcon isExpanded={isExpanded} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isExpanded}>
        <DyadCardPresentationContext.Provider value="embedded">
          <div className="space-y-1">{children}</div>
        </DyadCardPresentationContext.Provider>
      </DyadCardContent>
    </DyadCard>
  );
}
