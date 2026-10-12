import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import {
  MAX_PREVIEW_SIDE,
  MIN_PREVIEW_SIDE,
  tabletSizeFromSettings,
} from "@/lib/previewDevice";
import { showError, showSuccess } from "@/lib/toast";

function parseSide(value: string) {
  const number = Number(value);
  return Number.isInteger(number) &&
    number >= MIN_PREVIEW_SIDE &&
    number <= MAX_PREVIEW_SIDE
    ? number
    : null;
}

/**
 * The real tablet's size, sideways, in the pixels a web page sees. The
 * preview's tablet mode shows the page at exactly this size.
 */
export function PreviewTabletSizeSettings() {
  const { settings, updateSettings } = useSettings();
  const current = tabletSizeFromSettings(settings);
  const [width, setWidth] = useState(String(current.width));
  const [height, setHeight] = useState(String(current.height));

  useEffect(() => {
    setWidth(String(current.width));
    setHeight(String(current.height));
  }, [current.width, current.height]);

  const handleSave = async () => {
    const nextWidth = parseSide(width);
    const nextHeight = parseSide(height);
    if (nextWidth === null || nextHeight === null) {
      showError(
        `Use whole numbers from ${MIN_PREVIEW_SIDE} to ${MAX_PREVIEW_SIDE}.`,
      );
      return;
    }
    try {
      await updateSettings({
        previewTabletWidth: nextWidth,
        previewTabletHeight: nextHeight,
      });
      showSuccess("Preview tablet size saved");
    } catch (error: any) {
      showError(`Could not save the size: ${error?.message ?? error}`);
    }
  };

  const handleReset = async () => {
    try {
      await updateSettings({
        previewTabletWidth: undefined,
        previewTabletHeight: undefined,
      });
      showSuccess("Preview tablet size reset");
    } catch (error: any) {
      showError(`Could not reset the size: ${error?.message ?? error}`);
    }
  };

  return (
    <div className="space-y-2 max-w-lg">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          aria-label="Tablet width"
          className="w-28"
          value={width}
          onChange={(e) => setWidth(e.target.value)}
        />
        <span className="text-muted-foreground">&times;</span>
        <Input
          type="number"
          inputMode="numeric"
          aria-label="Tablet height"
          className="w-28"
          value={height}
          onChange={(e) => setHeight(e.target.value)}
        />
        <Button onClick={handleSave} data-testid="save-preview-tablet-size">
          Save
        </Button>
        <Button variant="ghost" onClick={handleReset}>
          Reset
        </Button>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Width and height of your tablet held sideways, in the pixels a web page
        sees (not the screen&apos;s physical pixels). On the tablet, open a
        &quot;what is my viewport&quot; page to read them. The preview&apos;s
        tablet mode shows your page at exactly this size, scaled down only if it
        does not fit.
      </p>
    </div>
  );
}
