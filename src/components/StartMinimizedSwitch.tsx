import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** Crackerbox opens minimized, in the taskbar, instead of taking the screen. */
export function StartMinimizedSwitch() {
  const { settings, updateSettings } = useSettings();

  if (!settings) {
    return null;
  }

  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="start-minimized"
        aria-label="Open minimized"
        checked={settings.startMinimized !== false}
        onCheckedChange={(checked) => {
          updateSettings({ startMinimized: checked });
        }}
      />
      <Label htmlFor="start-minimized">
        Open minimized (takes effect next time Crackerbox starts)
      </Label>
    </div>
  );
}
