import { getSubscriptionAccount } from "../services/codex_subscription_account";
import { createTypedHandler } from "./base";
import { settingsContracts } from "../types/settings";
import { writeSettings, readEffectiveSettings } from "../../main/settings";
import { validateProviderApiKey } from "../services/provider_api_key_validation_service";
import {
  connectCodexSubscription,
  disconnectCodexSubscription,
  acknowledgeSubscriptionConnection,
} from "../services/codex_subscription_auth";
import { app, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  connectGmail,
  disconnectGmail,
  forgetGmailCredentials,
  getGmailStatus,
  importGmailCredentials,
} from "../services/gmail_service";

export function registerSettingsHandlers() {
  createTypedHandler(
    settingsContracts.acknowledgeSubscriptionConnection,
    async () => acknowledgeSubscriptionConnection(),
  );
  createTypedHandler(settingsContracts.getCodexSubscriptionStatus, async () =>
    getSubscriptionAccount(),
  );
  createTypedHandler(
    settingsContracts.connectCodexSubscription,
    async (_, options) =>
      connectCodexSubscription({ selectModel: options.selectModel }),
  );
  createTypedHandler(settingsContracts.disconnectCodexSubscription, async () =>
    disconnectCodexSubscription(),
  );
  // Note: Settings handlers intentionally use createTypedHandler without logging
  // to avoid logging sensitive data (API keys, tokens, etc.) from args/return values.

  createTypedHandler(settingsContracts.getUserSettings, async () => {
    return readEffectiveSettings();
  });

  createTypedHandler(settingsContracts.setUserSettings, async (_, settings) => {
    writeSettings(settings);
    return readEffectiveSettings();
  });

  createTypedHandler(
    settingsContracts.validateProviderApiKey,
    async (_, params) => {
      return validateProviderApiKey(params);
    },
  );

  createTypedHandler(settingsContracts.getGmailStatus, async () =>
    getGmailStatus(),
  );
  createTypedHandler(settingsContracts.importGmailCredentials, async () => {
    const downloads = app.getPath("downloads");
    const downloadedCredential = fs
      .readdirSync(downloads, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith("client_secret_") &&
          entry.name.endsWith(".json"),
      )
      .map((entry) => {
        const filePath = path.join(downloads, entry.name);
        return { filePath, modified: fs.statSync(filePath).mtimeMs };
      })
      .sort((a, b) => b.modified - a.modified)[0];

    if (downloadedCredential) {
      importGmailCredentials(downloadedCredential.filePath);
      return { imported: true };
    }

    const result = await dialog.showOpenDialog({
      title: "Choose Google OAuth credentials",
      properties: ["openFile"],
      filters: [{ name: "Google OAuth JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { imported: false };
    importGmailCredentials(result.filePaths[0]);
    return { imported: true };
  });
  createTypedHandler(settingsContracts.connectGmail, async () =>
    connectGmail(),
  );
  createTypedHandler(settingsContracts.disconnectGmail, async () =>
    disconnectGmail(),
  );
  createTypedHandler(settingsContracts.forgetGmailCredentials, async () =>
    forgetGmailCredentials(),
  );
}
