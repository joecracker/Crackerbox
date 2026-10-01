import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { ipc } from "@/ipc/types";
import { Button } from "@/components/ui/button";
import { showError, showSuccess } from "@/lib/toast";

type GmailStatus = { configured: boolean; connected: boolean };

export function GmailIntegration() {
  const [status, setStatus] = useState<GmailStatus>();
  const [busy, setBusy] = useState(false);

  const refresh = async () => setStatus(await ipc.settings.getGmailStatus());
  useEffect(() => {
    void refresh();
  }, []);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      showSuccess(success);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4" />
          <h3 className="text-sm font-medium">Gmail</h3>
          {status?.connected && (
            <span className="text-xs font-medium text-green-600 dark:text-green-400">
              Connected
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Send email after you approve it. Crackerbox cannot read or delete your
          mail.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!status?.configured && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await ipc.settings.importGmailCredentials();
                if (!result.imported) throw new Error("No file selected.");
              }, "Google credentials imported.")
            }
          >
            Use downloaded Google JSON
          </Button>
        )}
        {status?.configured && !status.connected && (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                run(() => ipc.settings.connectGmail(), "Gmail connected.")
              }
            >
              Connect Gmail
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                run(
                  () => ipc.settings.forgetGmailCredentials(),
                  "Google credentials removed.",
                )
              }
            >
              Remove setup
            </Button>
          </>
        )}
        {status?.connected && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(() => ipc.settings.disconnectGmail(), "Gmail disconnected.")
            }
          >
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}
