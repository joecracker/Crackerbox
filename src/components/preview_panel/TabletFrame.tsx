import type { ReactNode } from "react";

/**
 * Holds the tablet preview at its true size, scaled down to fit. The wrapper
 * takes the scaled space, so the page inside lays out at the real width while
 * the preview pane only shows the smaller, fitted picture.
 */
export function TabletFrame({
  enabled,
  width,
  height,
  scale,
  children,
}: {
  enabled: boolean;
  width: number;
  height: number;
  scale: number;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <div
      data-testid="tablet-frame"
      className="shrink-0 overflow-hidden"
      style={{ width: width * scale, height: height * scale }}
    >
      {children}
    </div>
  );
}
