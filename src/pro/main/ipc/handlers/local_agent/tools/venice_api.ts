/** Finds the first provider whose id matches `idPattern` and has a saved key. */
export function findProviderApiKey(
  providerSettings: Record<string, any> | undefined,
  idPattern: RegExp,
): string | undefined {
  for (const [id, value] of Object.entries(providerSettings ?? {})) {
    if (idPattern.test(id) && value?.apiKey?.value) {
      return value.apiKey.value as string;
    }
  }
  return undefined;
}

/** Finds the Venice API key among the providers the user has set up. */
export function findVeniceApiKey(
  providerSettings: Record<string, any> | undefined,
): string | undefined {
  return findProviderApiKey(providerSettings, /venice/i);
}

/** Finds the Siray API key (a Custom provider whose name contains "siray"). */
export function findSirayApiKey(
  providerSettings: Record<string, any> | undefined,
): string | undefined {
  return findProviderApiKey(providerSettings, /siray/i);
}

export const VENICE_API_BASE = "https://api.venice.ai/api/v1";
