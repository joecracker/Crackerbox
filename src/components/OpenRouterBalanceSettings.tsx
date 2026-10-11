import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";

/**
 * Optional OpenRouter management key. It is used only to read your credit
 * balance for the header chip -- never for chat or any model call.
 */
export function OpenRouterBalanceSettings() {
  const { settings, updateSettings } = useSettings();
  const queryClient = useQueryClient();
  const hasKey = Boolean(settings?.openRouterManagementKey);
  const [key, setKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const refreshBalance = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.openRouterBalance.status,
    });

  const handleSave = async () => {
    if (!key.trim()) return;
    setIsSaving(true);
    try {
      await updateSettings({
        openRouterManagementKey: { value: key.trim() },
      });
      setKey("");
      await refreshBalance();
      showSuccess("OpenRouter balance key saved");
    } catch (error: any) {
      showError(`Could not save the key: ${error?.message ?? error}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    try {
      await updateSettings({ openRouterManagementKey: undefined });
      await refreshBalance();
      showSuccess("OpenRouter balance key removed");
    } catch (error: any) {
      showError(`Could not remove the key: ${error?.message ?? error}`);
    }
  };

  return (
    <div className="space-y-2 max-w-lg">
      <Input
        type="password"
        placeholder={
          hasKey
            ? "Management key (saved -- paste a new one to replace it)"
            : "OpenRouter management key"
        }
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Shows how much credit you have left in the chat header. Create a
        management key at openrouter.ai/settings/management-keys (a regular chat
        key will not work). It is only used to read your balance, never to run
        models, and nothing is limited or paused based on it.
      </p>
      <div className="flex items-center gap-2">
        <Button
          onClick={handleSave}
          disabled={isSaving || !key.trim()}
          data-testid="save-openrouter-balance-key"
        >
          {isSaving ? "Saving..." : "Save"}
        </Button>
        {hasKey && (
          <Button variant="ghost" onClick={handleRemove}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
