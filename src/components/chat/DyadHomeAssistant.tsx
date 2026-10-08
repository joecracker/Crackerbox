import { FileSearch, Files, ListTree, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  DyadBadge,
  DyadCard,
  DyadCardContent,
  DyadCardHeader,
  DyadExpandIcon,
  DyadFilePath,
  DyadStateIndicator,
} from "./DyadCardPrimitives";
import type { CustomTagState } from "./stateTypes";

export type HomeAssistantAction =
  | "write-file"
  | "delete-file"
  | "read-file"
  | "list-files"
  | "list-entities";

interface DyadHomeAssistantProps {
  action: HomeAssistantAction;
  path?: string;
  domain?: string;
  search?: string;
  state: CustomTagState;
  children?: React.ReactNode;
}

const ACTION_ICONS = {
  "write-file": Upload,
  "delete-file": Trash2,
  "read-file": FileSearch,
  "list-files": Files,
  "list-entities": ListTree,
};

export function DyadHomeAssistant({
  action,
  path = "",
  domain = "",
  search = "",
  state,
  children,
}: DyadHomeAssistantProps) {
  const { t } = useTranslation("chat");
  const [isExpanded, setIsExpanded] = useState(false);
  const Icon = ACTION_ICONS[action];
  const content = typeof children === "string" ? children : "";
  const hasDetails = content.length > 0;
  const filter = [domain, search].filter(Boolean).join(" · ");

  return (
    <DyadCard
      state={state}
      accentColor="teal"
      onClick={hasDetails ? () => setIsExpanded((value) => !value) : undefined}
      isExpanded={hasDetails ? isExpanded : undefined}
      data-testid={`dyad-ha-${action}`}
    >
      <DyadCardHeader icon={<Icon size={15} />} accentColor="teal">
        <DyadBadge color="teal">{t("homeAssistant.badge")}</DyadBadge>
        <span className="min-w-0 truncate text-sm font-medium">
          {t(`homeAssistant.${action}`)}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <DyadStateIndicator
            state={state}
            pendingLabel={t("homeAssistant.running")}
            abortedLabel={t("homeAssistant.interrupted")}
          />
          {hasDetails && <DyadExpandIcon isExpanded={isExpanded} />}
        </div>
      </DyadCardHeader>
      <DyadFilePath path={path || filter} />
      <DyadCardContent isExpanded={hasDetails && isExpanded}>
        <pre
          className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 text-xs"
          onClick={(event) => event.stopPropagation()}
        >
          {content}
        </pre>
      </DyadCardContent>
    </DyadCard>
  );
}
