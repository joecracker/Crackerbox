/** Finds the Venice API key among the providers the user has set up. */
export function findVeniceApiKey(
  providerSettings: Record<string, any> | undefined,
): string | undefined {
  for (const [id, value] of Object.entries(providerSettings ?? {})) {
    if (/venice/i.test(id) && value?.apiKey?.value) {
      return value.apiKey.value as string;
    }
  }
  return undefined;
}

export const VENICE_API_BASE = "https://api.venice.ai/api/v1";
