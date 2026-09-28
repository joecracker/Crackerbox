import { useEffect, useState } from "react";

// Below this width, Crackerbox switches from the desktop hover-flyout
// sidebar to a bottom tab bar (see MobileBottomNav / app/layout.tsx). The
// desktop Electron window is essentially never this narrow, so this only
// actually fires for the phone-bridge client (src/main/phone_bridge_server.ts).
const MOBILE_BREAKPOINT_PX = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const handleChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", handleChange);
    handleChange(); // Check current size in case it changed before mount.
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return isMobile;
}