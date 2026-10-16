import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/hooks/useSettings";
import { ipc } from "@/ipc/types";
import { showError, showSuccess } from "@/lib/toast";
import {
  buildPairingUrl,
  normalizeRemoteAddress,
  sortLanUrls,
} from "@/lib/phone_pairing";
import { qrDataUrl } from "@/lib/qr_code";

type Where = "wifi" | "anywhere";

/**
 * "Add a phone": a QR code the phone's camera scans to open Crackerbox, with no
 * typing. On home Wi-Fi it points at this computer. From anywhere it points at
 * the user's own Cloudflare address (their own free Cloudflare account is
 * needed for that part; see docs/phone-remote.md).
 */
export function PhoneSettings() {
  const { settings, updateSettings } = useSettings();
  const [remoteText, setRemoteText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [where, setWhere] = useState<Where | null>(null);

  useEffect(() => {
    if (loaded || !settings) return;
    setRemoteText(settings.phoneRemoteAddress ?? "");
    setLoaded(true);
  }, [settings, loaded]);

  useEffect(() => {
    let cancelled = false;
    ipc.system
      .getPhoneAccessInfo()
      .then((info) => {
        if (!cancelled) setLanUrls(sortLanUrls(info.lanUrls));
      })
      .catch(() => {
        if (!cancelled) setLanUrls([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const savedRemote = settings?.phoneRemoteAddress ?? "";
  const remoteResult = savedRemote ? normalizeRemoteAddress(savedRemote) : null;
  const remoteOrigin = remoteResult?.ok ? remoteResult.origin : null;
  const shown: Where = where ?? (remoteOrigin ? "anywhere" : "wifi");

  const target =
    shown === "anywhere"
      ? remoteOrigin
        ? buildPairingUrl(remoteOrigin)
        : null
      : lanUrls[0]
        ? buildPairingUrl(lanUrls[0])
        : null;
  const picture = useMemo(() => (target ? qrDataUrl(target) : null), [target]);

  const handleSave = async () => {
    if (!remoteText.trim()) {
      await updateSettings({ phoneRemoteAddress: "" });
      showSuccess("Remote address cleared.");
      return;
    }
    const result = normalizeRemoteAddress(remoteText);
    if (!result.ok) {
      showError(result.reason);
      return;
    }
    await updateSettings({ phoneRemoteAddress: result.origin });
    setRemoteText(result.origin);
    showSuccess("Saved. The QR code now points at your remote address.");
  };

  return (
    <div className="space-y-4 max-w-lg">
      <div className="flex gap-2">
        <Button
          variant={shown === "wifi" ? "default" : "outline"}
          onClick={() => setWhere("wifi")}
        >
          On home Wi-Fi
        </Button>
        <Button
          variant={shown === "anywhere" ? "default" : "outline"}
          onClick={() => setWhere("anywhere")}
        >
          From anywhere
        </Button>
      </div>

      {picture && target ? (
        <div className="space-y-2">
          <img
            data-testid="phone-qr"
            src={picture}
            alt="QR code to open Crackerbox on your phone"
            className="w-56 h-56 rounded bg-white p-1"
            style={{ imageRendering: "pixelated" }}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400 break-all">
            Or type this on the phone: {target.replace("?cbpair=1", "")}
          </p>
        </div>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {shown === "anywhere"
            ? "Save your remote address below to get a QR code for use away from home."
            : "No home Wi-Fi address was found for this computer. Check that it is on your network."}
        </p>
      )}

      <p className="text-sm text-gray-500 dark:text-gray-400">
        {shown === "anywhere"
          ? "Scan with the phone's camera. The phone asks you to sign in through Cloudflare if it needs to, then offers to install Crackerbox as an app."
          : "Scan with the phone's camera while it is on the same Wi-Fi as this computer. There is no sign-in on home Wi-Fi, so only use this on a network you trust."}
      </p>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Remote address</Label>
        <Input
          placeholder="e.g. remote.example.com (blank = home Wi-Fi only)"
          value={remoteText}
          onChange={(e) => setRemoteText(e.target.value)}
        />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Using Crackerbox from your phone away from home needs your own free
          Cloudflare account and a tunnel to this computer. Crackerbox does not
          set that up for you. The steps are in docs/phone-remote.md.
        </p>
        <Button onClick={handleSave}>Save</Button>
      </div>
    </div>
  );
}
