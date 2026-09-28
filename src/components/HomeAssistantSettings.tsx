import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { showError, showSuccess } from "@/lib/toast";

/**
 * Home Assistant connection: a long-lived access token for read-only entity
 * lookups, and SSH for file access under HA's config folder (dashboards,
 * www/, etc). Plain fields writing straight to settings via updateSettings --
 * no OAuth flow, no verification call here; the ha_* tools surface a clear
 * error themselves the first time something is missing or wrong.
 */
export function HomeAssistantSettings() {
  const { settings, updateSettings } = useSettings();
  const stored = settings?.homeAssistant;

  const [baseUrl, setBaseUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshUsername, setSshUsername] = useState("");
  const [sshPrivateKey, setSshPrivateKey] = useState("");
  const [configPath, setConfigPath] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded || !settings) return;
    setBaseUrl(stored?.baseUrl ?? "");
    // Secrets already saved show as a placeholder, not the real value --
    // leaving the field blank on save means "keep what's stored".
    setAccessToken(stored?.accessToken ? "" : "");
    setSshHost(stored?.sshHost ?? "");
    setSshPort(stored?.sshPort ? String(stored.sshPort) : "22");
    setSshUsername(stored?.sshUsername ?? "");
    setSshPrivateKey("");
    setConfigPath(stored?.configPath ?? "");
    setLoaded(true);
  }, [settings, stored, loaded]);

  const hasStoredToken = Boolean(stored?.accessToken);
  const hasStoredKey = Boolean(stored?.sshPrivateKey);

  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    const port = Number.parseInt(sshPort, 10);
    setIsSaving(true);
    try {
      await updateSettings({
        homeAssistant: {
          ...stored,
          baseUrl: baseUrl.trim() || undefined,
          // Blank means "leave it alone": omit the key entirely rather than
          // sending undefined, which settings_handlers treats as a clear.
          ...(accessToken.trim()
            ? { accessToken: { value: accessToken.trim() } }
            : {}),
          sshHost: sshHost.trim() || undefined,
          sshPort: Number.isFinite(port) && port > 0 ? port : undefined,
          sshUsername: sshUsername.trim() || undefined,
          ...(sshPrivateKey.trim()
            ? { sshPrivateKey: { value: sshPrivateKey.trim() } }
            : {}),
          configPath: configPath.trim() || undefined,
        },
      });
      setAccessToken("");
      setSshPrivateKey("");
      showSuccess("Home Assistant connection saved");
    } catch (error: any) {
      showError(`Could not save Home Assistant settings: ${error?.message ?? error}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleForgetHostKey = async () => {
    try {
      await updateSettings({
        homeAssistant: { ...stored, sshHostKeyFingerprint: undefined },
      });
      showSuccess(
        "Forgot the pinned host key. The next connection will pin whatever key the server presents.",
      );
    } catch (error: any) {
      showError(`Could not forget the host key: ${error?.message ?? error}`);
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          Entities (read-only, for building dashboards)
        </Label>
        <div className="space-y-2">
          <Input
            placeholder="Home Assistant URL, e.g. http://192.168.1.78:8123"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <Input
            type="password"
            placeholder={
              hasStoredToken
                ? "Long-lived access token (saved -- leave blank to keep it)"
                : "Long-lived access token"
            }
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
          />
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Create one from your Home Assistant profile (bottom of the page,
          under "Long-Lived Access Tokens"). Read-only: this only lists
          entities and their current state, never controls anything.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">
          SSH (for dashboard files and the www/ folder)
        </Label>
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              className="flex-1"
              placeholder="SSH host, e.g. 192.168.1.78"
              value={sshHost}
              onChange={(e) => setSshHost(e.target.value)}
            />
            <Input
              className="w-24"
              placeholder="Port"
              value={sshPort}
              onChange={(e) => setSshPort(e.target.value)}
            />
          </div>
          <Input
            placeholder="SSH username"
            value={sshUsername}
            onChange={(e) => setSshUsername(e.target.value)}
          />
          <textarea
            className="border-input flex min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] font-mono"
            placeholder={
              hasStoredKey
                ? "SSH private key, OpenSSH format (saved -- leave blank to keep it)"
                : "SSH private key, OpenSSH format (-----BEGIN OPENSSH PRIVATE KEY-----...)"
            }
            value={sshPrivateKey}
            onChange={(e) => setSshPrivateKey(e.target.value)}
          />
          <Input
            placeholder="Config folder root (default: /config)"
            value={configPath}
            onChange={(e) => setConfigPath(e.target.value)}
          />
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          The public half of this key needs to be in Home Assistant's SSH
          add-on authorized_keys. File access is confined to this config
          folder. The server's host key is pinned the first time Crackerbox
          connects, so a later swap is refused rather than silently trusted.
        </p>
        {stored?.sshHostKeyFingerprint && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <span className="font-mono truncate">
              Pinned: {stored.sshHostKeyFingerprint}
            </span>
            <Button variant="ghost" size="sm" onClick={handleForgetHostKey}>
              Forget
            </Button>
          </div>
        )}
      </div>

      <Button
        onClick={handleSave}
        disabled={isSaving}
        data-testid="save-home-assistant-settings"
      >
        {isSaving ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}