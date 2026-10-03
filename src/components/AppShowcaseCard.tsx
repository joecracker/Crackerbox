import { useEffect, useState } from "react";
import type { ListedApp } from "@/ipc/types/app";
import { MoreVertical } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface AppShowcaseCardProps {
  app: ListedApp;
  thumbnailUrl: string | null;
  onClick: (appId: number) => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (appId: number) => void;
  /** When given, a small menu on the card offers Rename. */
  onRename?: (app: ListedApp) => void;
  /** When given, a small menu on the card offers Delete. */
  onDelete?: (app: ListedApp) => void;
}

function getInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const codePoint = trimmed.codePointAt(0);
  return codePoint
    ? String.fromCodePoint(codePoint).toUpperCase()
    : trimmed[0].toUpperCase();
}

export function AppShowcaseCard({
  app,
  thumbnailUrl,
  onClick,
  isSelectionMode = false,
  isSelected = false,
  onToggleSelect,
  onRename,
  onDelete,
}: AppShowcaseCardProps) {
  const [imageBroken, setImageBroken] = useState(false);
  useEffect(() => {
    setImageBroken(false);
  }, [thumbnailUrl]);
  const showImage = thumbnailUrl && !imageBroken;

  const handleClick = () => {
    if (isSelectionMode) {
      onToggleSelect?.(app.id);
    } else {
      onClick(app.id);
    }
  };

  const showMenu = !isSelectionMode && (onRename || onDelete);

  return (
    <div className="group/card relative">
      <button
        type="button"
        onClick={handleClick}
        title={app.name}
        data-testid={`app-showcase-card-${app.name}`}
        data-selected={isSelectionMode ? isSelected : undefined}
        role={isSelectionMode ? "checkbox" : undefined}
        aria-checked={isSelectionMode ? isSelected : undefined}
        className={cn(
          "group relative w-full aspect-[4/3] rounded-xl overflow-hidden border bg-muted hover:shadow-md transition-all duration-200 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          isSelectionMode && isSelected
            ? "border-primary ring-2 ring-primary/40"
            : "border-border hover:border-primary/40",
        )}
      >
        {showImage ? (
          <img
            src={thumbnailUrl!}
            alt=""
            loading="lazy"
            onError={() => setImageBroken(true)}
            className="absolute inset-0 w-full h-full object-cover object-top"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-primary/10 to-primary/30">
            <span className="text-3xl font-semibold text-primary/80">
              {getInitial(app.name)}
            </span>
          </div>
        )}
        {isSelectionMode && (
          <div className="absolute top-2 left-2 flex items-center justify-center rounded bg-background/90 p-1 shadow-sm pointer-events-none">
            <Checkbox
              checked={isSelected}
              tabIndex={-1}
              aria-hidden="true"
              data-testid={`app-showcase-card-${app.name}-checkbox`}
            />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent pt-8 pb-2.5 px-3">
          <p className="text-sm font-semibold text-white truncate text-left">
            {app.name}
          </p>
        </div>
      </button>
      {showMenu && (
        <div className="absolute top-2 right-2 z-10">
          {/* Same pattern as the other card menus in the app (see
              MediaFileThumbnail): this menu library takes the trigger's
              styling directly and fires items on click, not on select. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              aria-label={`Actions for ${app.name}`}
              data-testid={`app-showcase-card-${app.name}-menu`}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-sm transition-opacity hover:bg-black/75 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onRename && (
                <DropdownMenuItem onClick={() => onRename(app)}>
                  Rename...
                </DropdownMenuItem>
              )}
              {onDelete && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDelete(app)}
                >
                  Delete...
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
