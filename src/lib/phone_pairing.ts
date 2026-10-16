// Pure helpers for "Add a phone": turning what the user typed into a real
// address, building the address a QR code carries, and choosing which of the
// computer's home-network addresses to show.

export type RemoteAddressResult =
  | { ok: true; origin: string }
  | { ok: false; reason: string };

/**
 * The remote address is the one the user's own Cloudflare tunnel answers on,
 * e.g. remote.example.com. Anything typed is cleaned down to https://host.
 */
export function normalizeRemoteAddress(input: string): RemoteAddressResult {
  const text = input.trim();
  if (!text) return { ok: false, reason: "Type your remote address first." };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    ? text
    : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: "That does not look like an address." };
  }
  if (url.protocol !== "https:") {
    return {
      ok: false,
      reason:
        "The remote address has to start with https:// (Cloudflare gives you that).",
    };
  }
  if (!url.hostname.includes(".")) {
    return {
      ok: false,
      reason: "That needs a full host name, like remote.example.com.",
    };
  }
  return { ok: true, origin: url.origin };
}

/** The address a QR code carries. cbpair=1 makes the phone offer to install. */
export function buildPairingUrl(base: string): string {
  const url = new URL(base);
  url.pathname = "/";
  url.search = "?cbpair=1";
  url.hash = "";
  return url.toString();
}

function rank(url: string): number {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return 9;
  }
  if (host.startsWith("192.168.")) return 0;
  if (host.startsWith("10.")) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return 2;
  return 3;
}

/** Home Wi-Fi addresses usually start 192.168; virtual ones (10.x, 172.x) come after. */
export function sortLanUrls(urls: string[]): string[] {
  return [...urls].sort((a, b) => rank(a) - rank(b));
}
