import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import {
  Blocks,
  BookOpen,
  Home,
  MoreHorizontal,
  Plus,
  Settings,
  Store,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { ipc } from "@/ipc/types";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useOpenApp } from "@/hooks/useOpenApp";
import { DoorButton } from "@/components/Door";
import { AddEntityDialog } from "@/components/AddEntityDialog";
import { SisterBadge } from "@/components/SisterPicker";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// Phone-bridge-only nav (see src/hooks/use-mobile.ts and app/layout.tsx).
// The desktop sidebar's hover-to-expand flyout (app-sidebar.tsx) has no
// touch equivalent, so on a narrow viewport we swap it for a plain bottom
// bar with five fixed slots: Home, Crew (the entities), Door, Settings, and
// More (the sections that did not fit).
const MORE_ITEMS: Array<{ title: string; to: string; icon: LucideIcon }> = [
  { title: "Library", to: "/library", icon: BookOpen },
  { title: "Plugins", to: "/plugins", icon: Blocks },
  { title: "Templates", to: "/templates", icon: Store },
];

export const MOBILE_BOTTOM_NAV_HEIGHT_PX = 56;

const SLOT_CLASS =
  "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring";

function slotColor(isActive: boolean) {
  return isActive
    ? "text-primary"
    : "text-sidebar-foreground/70 active:text-sidebar-foreground";
}

/** A row in one of the pop-up sheets: at least 48px tall, easy to hit with a thumb. */
const ROW_CLASS =
  "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-base outline-none active:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring";

function CrewSheet({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: () => void;
}) {
  const sisters = useQuery({
    queryKey: ["house", "sisters"],
    queryFn: () => ipc.chat.listSisters(),
  });
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const openApp = useOpenApp();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
        data-testid="mobile-crew-sheet"
      >
        <SheetHeader>
          <SheetTitle>Your crew</SheetTitle>
        </SheetHeader>
        <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto px-3 pb-3">
          {sisters.data?.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-label={s.name}
              data-testid={`mobile-crew-${s.id}`}
              onClick={() => {
                onOpenChange(false);
                openApp(s.appId);
              }}
              className={cn(
                ROW_CLASS,
                selectedAppId === s.appId && "bg-primary/15",
              )}
            >
              <SisterBadge
                color={s.color}
                initial={s.initial}
                avatarUrl={s.avatarUrl}
                size={32}
              />
              <span
                className={cn(
                  "truncate",
                  selectedAppId === s.appId && "font-medium text-primary",
                )}
              >
                {s.name}
              </span>
            </button>
          ))}
          <button
            type="button"
            aria-label="Add an entity"
            data-testid="mobile-crew-add"
            onClick={() => {
              onOpenChange(false);
              onAdd();
            }}
            className={cn(ROW_CLASS, "text-sidebar-foreground/80")}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-sidebar-foreground/40">
              <Plus size={18} />
            </span>
            <span>Add an entity</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MoreSheet({
  open,
  onOpenChange,
  pathname,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pathname: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
        data-testid="mobile-more-sheet"
      >
        <SheetHeader>
          <SheetTitle>More</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-1 px-3 pb-3">
          {MORE_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname.startsWith(item.to);
            return (
              <Link
                key={item.title}
                to={item.to}
                aria-label={item.title}
                data-testid={`mobile-more-${item.title.toLowerCase()}`}
                onClick={() => onOpenChange(false)}
                className={cn(
                  ROW_CLASS,
                  isActive && "bg-primary/15 text-primary",
                )}
              >
                <Icon className="size-5" />
                <span>{item.title}</span>
              </Link>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function MobileBottomNav() {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;
  const [crewOpen, setCrewOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const homeActive = pathname === "/" || pathname === "/chat";
  const settingsActive = pathname.startsWith("/settings");
  const moreActive = MORE_ITEMS.some((item) => pathname.startsWith(item.to));

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-20 flex items-stretch justify-around border-t border-sidebar-border bg-sidebar"
        style={{
          height: MOBILE_BOTTOM_NAV_HEIGHT_PX,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <Link
          to="/"
          aria-label="Home"
          data-testid="mobile-nav-home"
          className={cn(SLOT_CLASS, slotColor(homeActive))}
        >
          <Home className="size-5" />
          <span>Home</span>
        </Link>
        <button
          type="button"
          aria-label="Crew"
          data-testid="mobile-nav-crew"
          onClick={() => setCrewOpen(true)}
          className={cn(SLOT_CLASS, slotColor(crewOpen))}
        >
          <Users className="size-5" />
          <span>Crew</span>
        </button>
        <DoorButton isExpanded={false} variant="bar" />
        <Link
          to="/settings"
          aria-label="Settings"
          data-testid="mobile-nav-settings"
          className={cn(SLOT_CLASS, slotColor(settingsActive))}
        >
          <Settings className="size-5" />
          <span>Settings</span>
        </Link>
        <button
          type="button"
          aria-label="More"
          data-testid="mobile-nav-more"
          onClick={() => setMoreOpen(true)}
          className={cn(SLOT_CLASS, slotColor(moreActive || moreOpen))}
        >
          <MoreHorizontal className="size-5" />
          <span>More</span>
        </button>
      </nav>
      <CrewSheet
        open={crewOpen}
        onOpenChange={setCrewOpen}
        onAdd={() => setAddOpen(true)}
      />
      <MoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        pathname={pathname}
      />
      <AddEntityDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
