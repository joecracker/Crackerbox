import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/useSettings";

const VOICES = [
  ["af_bella", "Bella — warm American"],
  ["af_heart", "Heart — expressive American"],
  ["af_nicole", "Nicole — calm American"],
  ["af_sarah", "Sarah — clear American"],
  ["bf_emma", "Emma — British"],
  ["bf_isabella", "Isabella — British"],
] as const;

export function VoiceSettings() {
  const { settings, updateSettings } = useSettings();
  const voice = settings?.speechVoice ?? "af_bella";
  const rate = settings?.speechRate ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-2">
        <Switch
          id="auto-speak-responses"
          aria-label="Auto-speak responses"
          checked={settings?.autoSpeakResponses === true}
          onCheckedChange={(checked) =>
            void updateSettings({ autoSpeakResponses: checked })
          }
        />
        <Label htmlFor="auto-speak-responses">Auto-speak new responses</Label>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Crackerbox speaks only the reply prose—not code, tool activity, or
        internal details.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-sm font-medium">Voice</Label>
        <Select
          value={voice}
          onValueChange={(value) => {
            if (value) void updateSettings({ speechVoice: value });
          }}
        >
          <SelectTrigger className="min-w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VOICES.map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label className="text-sm font-medium">Speed</Label>
        <Select
          value={String(rate)}
          onValueChange={(value) => {
            if (value) void updateSettings({ speechRate: Number(value) });
          }}
        >
          <SelectTrigger className="min-w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[0.8, 0.9, 1, 1.1, 1.2].map((value) => (
              <SelectItem key={value} value={String(value)}>
                {value}×
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
