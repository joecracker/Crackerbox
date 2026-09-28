import { Home, Settings, BookOpen, Store, Blocks } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

// Phone-bridge-only nav (see src/hooks/use-mobile.ts and app/layout.tsx).
// The desktop sidebar's hover-to-expand flyout (app-sidebar.tsx) has no
// touch equivalent, so on a narrow viewport we swap it for a plain bottom
// tab bar that jumps straight to each section instead. Mirrors the same
// five destinations as the desktop sidebar's icon rail.
const items: Array<{ title: string; to: string; icon: LucideIcon }> = [
  { title: "Apps", to: "/", icon: Home },
  { title: "Settings", to: "/settings", icon: Settings },
  { title: "Library", to: "/library", icon: BookOpen },
  { title: "Templates", to: "/templates", icon: Store },
  { title: "Plugins", to: "/plugins", icon: Blocks },
];

export const MOBILE_BOTTOM_NAV_HEIGHT_PX = 56;

export function MobileBottomNav() {
  const routerState = useRouterState();
  const pathname = routerState.location.pathname;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex items-stretch justify-around border-t border-sidebar-border bg-sidebar"
      style={{
        height: MOBILE_BOTTOM_NAV_HEIGHT_PX,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {items.map((item) => {
        const isActive =
          item.to === "/"
            ? pathname === "/" || pathname === "/chat"
            : pathname.startsWith(item.to);
        const Icon = item.icon;
        return (
          <Link
            key={item.title}
            to={item.to}
            aria-label={item.title}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px]",
              isActive
                ? "text-primary"
                : "text-sidebar-foreground/70 active:text-sidebar-foreground",
            )}
          >
            <Icon className={cn("size-5", isActive && "text-primary")} />
            <span>{item.title}</span>
          </Link>
        );
      })}
    </nav>
  );
}
