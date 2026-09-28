import { BrowserWindow, nativeTheme } from "electron";

import { safeSend } from "../utils/safe_sender";
import { systemContracts, systemEvents } from "../types/system";
import { createTypedHandler } from "./base";

function getNativeThemeState() {
  return { shouldUseDarkColors: nativeTheme.shouldUseDarkColors };
}

function publishNativeThemeState(): void {
  const state = getNativeThemeState();
  for (const window of BrowserWindow.getAllWindows()) {
    safeSend(
      window.webContents,
      systemEvents.nativeThemeUpdated.channel,
      state,
    );
    if (process.platform === "win32" && !window.isDestroyed()) {
      window.setTitleBarOverlay({
        color: state.shouldUseDarkColors ? "#181818" : "#f1f0f7",
        symbolColor: state.shouldUseDarkColors ? "#ffffff" : "#000000",
        height: 36,
      });
    }
  }
}

export function registerNativeThemeHandlers(): void {
  createTypedHandler(systemContracts.getNativeThemeState, async () =>
    getNativeThemeState(),
  );
  nativeTheme.on("updated", publishNativeThemeState);
}
