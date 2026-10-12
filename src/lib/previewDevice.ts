export type FrameSize = { width: number; height: number };

// A placeholder for a 1920x1200 tablet at the usual Android scale, sideways.
// Replace it in Settings with the numbers the real tablet reports.
export const DEFAULT_TABLET_SIZE: FrameSize = { width: 1280, height: 800 };
export const MIN_PREVIEW_SIDE = 200;
export const MAX_PREVIEW_SIDE = 4000;

function validSide(value: number | undefined) {
  return Number.isInteger(value) &&
    (value as number) >= MIN_PREVIEW_SIDE &&
    (value as number) <= MAX_PREVIEW_SIDE
    ? (value as number)
    : undefined;
}

/** The tablet preview size from settings, or the default for anything unset or out of range. */
export function tabletSizeFromSettings(
  settings:
    | { previewTabletWidth?: number; previewTabletHeight?: number }
    | null
    | undefined,
): FrameSize {
  return {
    width: validSide(settings?.previewTabletWidth) ?? DEFAULT_TABLET_SIZE.width,
    height:
      validSide(settings?.previewTabletHeight) ?? DEFAULT_TABLET_SIZE.height,
  };
}

/** The scale that fits a frame entirely inside the space available. It never enlarges the frame. */
export function fitScale(available: FrameSize, size: FrameSize) {
  if (available.width <= 0 || available.height <= 0) return 1;
  return Math.min(
    1,
    available.width / size.width,
    available.height / size.height,
  );
}
