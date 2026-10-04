import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/hooks/useSettings";
import { useLocalModels } from "@/hooks/useLocalModels";
import { useLocalLMSModels } from "@/hooks/useLMStudioModels";
import { showError, showSuccess } from "@/lib/toast";

/**
 * For people running Ollama or LM Studio on another computer: type its address
 * here instead of setting environment variables. Blank means this computer.
 */
export function LocalAiSettings() {
  const { settings, updateSettings } = useSettings();
  const { loadModels: loadOllamaModels } = useLocalModels();
  const { loadModels: loadLmStudioModels } = useLocalLMSModels();
  const [ollamaHost, setOllamaHost] = useState("");
  const [lmStudioUrl, setLmStudioUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loaded || !settings) return;
    setOllamaHost(settings.localAi?.ollamaHost ?? "");
    setLmStudioUrl(settings.localAi?.lmStudioUrl ?? "");
    setLoaded(true);
  }, [settings, loaded]);

  const handleSave = async () => {
    setBusy(true);
    try {
      await updateSettings({
        localAi: {
          ollamaHost: ollamaHost.trim() || undefined,
          lmStudioUrl: lmStudioUrl.trim() || undefined,
        },
      });
      const parts: string[] = [];
      if (ollamaHost.trim() || !lmStudioUrl.trim()) {
        const models = await loadOllamaModels();
        parts.push(`Ollama: ${models.length} model(s) found`);
      }
      if (lmStudioUrl.trim() || !ollamaHost.trim()) {
        const models = await loadLmStudioModels();
        parts.push(`LM Studio: ${models.length} model(s) found`);
      }
      showSuccess(`Saved. ${parts.join(". ")}.`);
    } catch (error: any) {
      showError(`Could not save: ${error?.message ?? error}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 max-w-lg">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Your own AI computer</Label>
        <Input
          placeholder="Ollama address, e.g. 192.168.1.50 (blank = this computer)"
          value={ollamaHost}
          onChange={(e) => setOllamaHost(e.target.value)}
        />
        <Input
          placeholder="LM Studio address, e.g. 192.168.1.50:1234 (blank = this computer)"
          value={lmStudioUrl}
          onChange={(e) => setLmStudioUrl(e.target.value)}
        />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Running Ollama or LM Studio on another computer? Type its address here
          and its models show up in the model picker. That computer must allow
          connections from the network (Ollama: set OLLAMA_HOST to 0.0.0.0
          there).
        </p>
      </div>
      <Button onClick={handleSave} disabled={busy}>
        {busy ? "Checking..." : "Save and check connection"}
      </Button>
    </div>
  );
}
