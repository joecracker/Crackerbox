import { shell } from "electron";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { createLoggedTypedHandler } from "./base";
import { readSettings } from "../../main/settings"; // Assuming settings are read this way
import { UserBudgetInfo, UserBudgetInfoSchema } from "@/ipc/types";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { audioContracts } from "../types/audio";
import {
  findPocketExe,
  pocketVoicesDir,
  synthesizeSpeech,
} from "../services/speech_service";
import {
  deleteCustomPocketVoice,
  makeCustomPocketVoice,
} from "../services/pocket_voice_maker";
import { listCustomPocketVoices } from "../services/pocket_custom_voices";
import fs from "node:fs";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

import { fetchUserInfo } from "../services/user_budget_service";
export {
  UserInfoResponseSchema,
  type UserInfoResponse,
} from "../services/user_budget_service";

const logger = log.scope("pro_handlers");
const handle = createLoggedHandler(logger);
const typedHandle = createLoggedTypedHandler(logger);

export function registerProHandlers() {
  typedHandle(audioContracts.synthesizeSpeech, async (_event, input) => {
    return synthesizeSpeech(input);
  });
  typedHandle(audioContracts.listPocketVoices, async () => {
    const folder = pocketVoicesDir();
    return {
      custom: listCustomPocketVoices(folder).map(({ id, label }) => ({
        id,
        label,
      })),
      folder,
    };
  });
  typedHandle(audioContracts.createPocketVoice, async (_event, input) => {
    return makeCustomPocketVoice({
      dir: pocketVoicesDir(),
      exe: findPocketExe(),
      name: input.name,
      extension: input.extension,
      bytes: input.audioData,
    });
  });
  typedHandle(audioContracts.deletePocketVoice, async (_event, input) => {
    deleteCustomPocketVoice(pocketVoicesDir(), input.id);
  });
  typedHandle(audioContracts.openPocketVoicesFolder, async () => {
    const folder = pocketVoicesDir();
    fs.mkdirSync(folder, { recursive: true });
    const failure = await shell.openPath(folder);
    if (failure) {
      throw new DyadError(
        `Could not open the My voices folder: ${failure}`,
        DyadErrorKind.External,
      );
    }
  });
  // This method should try to avoid throwing errors because this is auxiliary
  // information and isn't critical to using the app
  handle("get-user-budget", async (): Promise<UserBudgetInfo | null> => {
    if (IS_TEST_BUILD) {
      // Return mock budget data for E2E tests instead of spamming the API
      const resetDate = new Date();
      resetDate.setDate(resetDate.getDate() + 30); // Reset in 30 days
      return {
        usedCredits: 100,
        totalCredits: 1000,
        budgetResetDate: resetDate,
        redactedUserId: "<redacted-user-id-testing>",
        isTrial: false,
      };
    }
    logger.debug("Attempting to fetch user budget information.");

    const settings = readSettings();

    const apiKey = settings.providerSettings?.auto?.apiKey?.value;

    if (!apiKey) {
      // Expected state for non-Pro users; not an error.
      logger.debug("LLM Gateway API key (Dyad Pro) is not configured.");
      return null;
    }

    try {
      const data = await fetchUserInfo(apiKey);

      // Turn user_abc1234 =>  "****1234"
      // Preserve the last 4 characters so we can correlate bug reports
      // with the user.
      const redactedUserId =
        data.userId.length > 8 ? "****" + data.userId.slice(-4) : "<redacted>";

      logger.debug("Successfully fetched user budget information.");

      // Transform to UserBudgetInfo format
      const userBudgetInfo = UserBudgetInfoSchema.parse({
        usedCredits: data.usedCredits,
        totalCredits: data.totalCredits,
        budgetResetDate: new Date(data.budgetResetDate),
        redactedUserId: redactedUserId,
        isTrial: data.isTrial,
      });

      return userBudgetInfo;
    } catch (error: any) {
      logger.error(`Error fetching user budget: ${error.message}`, error);
      return null;
    }
  });
}
