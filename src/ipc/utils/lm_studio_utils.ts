import { getConfiguredLmStudioUrl } from "./local_ai_hosts";

export function getLmStudioBaseUrl(): string {
  return (
    process.env.LM_STUDIO_BASE_URL_FOR_TESTING ||
    getConfiguredLmStudioUrl() ||
    "http://localhost:1234"
  );
}
