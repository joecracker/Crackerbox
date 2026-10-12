import { Hammer } from "lucide-react";

/**
 * One explicit tap that sends "Go ahead and build that." in Build mode. It only
 * appears under a reply that has not changed anything, and nothing builds
 * unless it is tapped.
 */
export function BuildItChip({ onBuild }: { onBuild: () => void }) {
  return (
    <div className="flex justify-end px-1 pb-1.5">
      <button
        type="button"
        data-testid="build-it-chip"
        onClick={onBuild}
        className="flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-(--background-lighter) px-3 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:border-[var(--brand-pinstripe)] hover:text-[var(--brand-pinstripe)]"
      >
        <Hammer size={14} />
        Build it
      </button>
    </div>
  );
}
