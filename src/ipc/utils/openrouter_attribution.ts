export const OPENROUTER_APP_REFERER = "https://crackerbox.app";
export const OPENROUTER_APP_TITLE = "Crackerbox";
export const OPENROUTER_APP_CATEGORIES = "native-app-builder,programming-app";

export function getOpenRouterAppAttributionHeaders(): Record<string, string> {
  return {
    "HTTP-Referer": OPENROUTER_APP_REFERER,
    "X-OpenRouter-Title": OPENROUTER_APP_TITLE,
    "X-OpenRouter-Categories": OPENROUTER_APP_CATEGORIES,
  };
}
