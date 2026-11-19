import { SETTING_IDS } from "@/lib/settingsSearchIndex";
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
import { usePocketVoices } from "@/hooks/usePocketVoices";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/types";
import { showError } from "@/lib/toast";

const VOICES = [
  ["af_heart", "Heart — expressive American"],
  ["af_nicole", "Nicole — calm American"],
  ["af_sarah", "Sarah — clear American"],
  ["bf_emma", "Emma — British"],
  ["bf_isabella", "Isabella — British"],
] as const;

export function VoiceSettings() {
  const { settings, updateSettings } = useSettings();
  const provider = settings?.speechProvider ?? "openrouter";
  const savedVoice = settings?.speechVoice ?? "af_heart";
  const pocket = usePocketVoices();
  const voiceList = provider === "pocket" ? pocket.voices : VOICES;
  // A voice from the other engine reads as that engine's default.
  const voice = voiceList.some(([id]) => id === savedVoice)
    ? savedVoice
    : voiceList[0][0];
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
        <Label className="text-sm font-medium">Voice engine</Label>
        <Select
          value={provider}
          onValueChange={(value) => {
            if (
              value === "openrouter" ||
              value === "venice" ||
              value === "local" ||
              value === "pocket"
            ) {
              void updateSettings({ speechProvider: value });
            }
          }}
        >
          <SelectTrigger className="min-w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openrouter">
              OpenRouter — smooth cloud voice
            </SelectItem>
            <SelectItem value="venice">
              Venice — uses your Venice key
            </SelectItem>
            <SelectItem value="pocket">
              Pocket — natural voice on this PC
            </SelectItem>
            <SelectItem value="local">Local — offline backup</SelectItem>
          </SelectContent>
        </Select>
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
            {voiceList.map(([id, label]) => (
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
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        OpenRouter and Venice both use your existing key and the hosted Kokoro
        voice model. If the cloud is unavailable, Crackerbox automatically uses
        the local voice.
      </p>
      {provider === "pocket" && (
        <>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Pocket runs on this PC. The first reply after starting can take a
            little while; until it is ready, the local Kokoro voice speaks.
          </p>
          <div
            className="space-y-2 rounded-md border p-3"
            data-testid="my-voices"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">My voices</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void ipc.audio
                    .openPocketVoicesFolder()
                    .then(() => pocket.refetch())
                    .catch((error) =>
                      showError(
                        error instanceof Error ? error.message : String(error),
                      ),
                    )
                }
              >
                Open My voices folder
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={pocket.isFetching}
                onClick={() => void pocket.refetch()}
              >
                Refresh list
              </Button>
              <span className="text-xs text-muted-foreground">
                {pocket.custom.length === 0
                  ? "No voices yet"
                  : `${pocket.custom.length} voice${pocket.custom.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Drop a clean recording of one voice (a few seconds up to 30, .wav
              or .flac works best) into the folder, press Refresh list, and it
              shows up in Voice above and in each entity's voice. A .safetensors
              voice made with Pocket's export-voice is much faster than a
              recording. Use voices you have the right to use.
            </p>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Voice cloning needs a one-time unlock from Pocket's makers: accept
              the terms at huggingface.co/kyutai/pocket-tts, then sign in on
              this PC with "hf auth login". Until then your own voices fall back
              to the Kokoro voice.
            </p>
          </div>
        </>
      )}
      {provider === "venice" && voice === "bf_isabella" && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Venice doesn't have Isabella, so it speaks with Heart instead.
        </p>
      )}
    </div>
  );
}

/** Show only the final message of each reply (a chat display option, so it lives in Workflow). */
export function SummaryViewSwitch() {
  const { settings, updateSettings } = useSettings();
  return (
    <div id={SETTING_IDS.summaryView} className="space-y-1.5">
      <div className="flex items-center space-x-2">
        <Switch
          id="summary-view"
          aria-label="Summary view"
          checked={settings?.summaryView !== false}
          onCheckedChange={(checked) =>
            void updateSettings({ summaryView: checked })
          }
        />
        <Label htmlFor="summary-view">Summary view</Label>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Show only the final message of each reply. Her steps, file reads and
        thinking fold under "Show work". The voice reads what the chat shows.
      </p>
    </div>
  );
}
