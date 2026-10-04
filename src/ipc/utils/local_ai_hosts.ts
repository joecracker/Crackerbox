import { readSettings } from "@/main/settings";

/**
 * Turn whatever the user typed for an LM Studio address into a base URL
 * without a trailing slash or /v1 ("192.168.1.50" -> "http://192.168.1.50:1234").
 */
export function normalizeLmStudioUrl(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (!url.port && url.protocol === "http:") url.port = "1234";
    return (url.origin + url.pathname)
      .replace(/\/+$/, "")
      .replace(/\/v1$/i, "");
  } catch {
    return undefined;
  }
}

function readLocalAi() {
  try {
    return readSettings().localAi;
  } catch {
    return undefined;
  }
}

/** The Ollama address typed in Settings, if any. */
export function getConfiguredOllamaHost(): string | undefined {
  return readLocalAi()?.ollamaHost?.trim() || undefined;
}

/** The LM Studio address typed in Settings, if any (already tidied up). */
export function getConfiguredLmStudioUrl(): string | undefined {
  return normalizeLmStudioUrl(readLocalAi()?.lmStudioUrl);
}
