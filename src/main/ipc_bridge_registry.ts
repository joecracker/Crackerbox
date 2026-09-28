// Monkey-patches ipcMain.handle/ipcMain.on to also record each channel's
// listener in a side-table, so the phone bridge (phone_bridge_server.ts) can
// invoke a registered handler directly from a WebSocket connection instead of
// a real Electron IPC round-trip. Electron has no public API to look up or
// call a registered ipcMain handler from outside the normal renderer<->main
// channel, so this is the standard workaround (same trick used by prior art
// like the `electron-to-web` package).
//
// Must be imported (for its side effect below) before registerIpcHandlers()
// runs in main.ts, so every handler registered by the real app also lands in
// these maps. The real ipcMain.handle/on calls are always still made too --
// the desktop window keeps working over real IPC exactly as before; this
// only adds a second, parallel way to reach the same listener.
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import log from "electron-log";

const logger = log.scope("ipc_bridge_registry");

type InvokeListener = (
  event: IpcMainInvokeEvent,
  ...args: any[]
) => any;
type OnListener = (event: IpcMainEvent, ...args: any[]) => void;

const invokeHandlers = new Map<string, InvokeListener>();
const onListeners = new Map<string, Set<OnListener>>();

let installed = false;

export function installIpcBridgeRegistry(): void {
  if (installed) return;
  installed = true;

  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = ((channel: string, listener: InvokeListener) => {
    if (invokeHandlers.has(channel)) {
      logger.warn(
        `ipcMain.handle registered twice for channel "${channel}" -- phone bridge will only call the latest one`,
      );
    }
    invokeHandlers.set(channel, listener);
    return originalHandle(channel, listener);
  }) as typeof ipcMain.handle;

  const originalOn = ipcMain.on.bind(ipcMain);
  ipcMain.on = ((channel: string, listener: OnListener) => {
    if (!onListeners.has(channel)) {
      onListeners.set(channel, new Set());
    }
    onListeners.get(channel)!.add(listener);
    return originalOn(channel, listener);
  }) as typeof ipcMain.on;

  logger.info("ipcMain.handle/on patched for phone bridge side-table");
}

/** The handler registered for `channel` via ipcMain.handle, if any. */
export function getRegisteredInvokeHandler(
  channel: string,
): InvokeListener | undefined {
  return invokeHandlers.get(channel);
}

/** All listeners registered for `channel` via ipcMain.on. */
export function getRegisteredOnListeners(channel: string): OnListener[] {
  const set = onListeners.get(channel);
  return set ? Array.from(set) : [];
}

// Patch immediately on import. main.ts only needs to import this module
// (for its side effect) before calling registerIpcHandlers() -- no explicit
// call required, but installIpcBridgeRegistry() is exported too in case a
// call site ever needs to be explicit about ordering.
installIpcBridgeRegistry();