import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

// The sisters have a shell. File tools already refuse Crackerbox's own data
// folder (it holds API keys and the database), so shell commands from a
// sister that name that folder are refused too. This is a best-effort check on
// the command text, not a sandbox.
const DATA_FOLDER =
  /(%appdata%|\$env:appdata|appdata[\\/]+roaming)[\\/]+crackerbox\b|user-settings\.json/i;

export function commandTouchesCrackerboxData(parts: Array<string | undefined>): boolean {
  return DATA_FOLDER.test(parts.filter(Boolean).join(" "));
}

export function assertSisterCommandAllowed(
  isSister: boolean,
  parts: Array<string | undefined>,
): void {
  if (isSister && commandTouchesCrackerboxData(parts)) {
    throw new DyadError(
      `That command reaches Crackerbox's own data folder, which holds passwords, keys or tokens, so it is never opened. Tell Tim what you need from it instead.`,
      DyadErrorKind.Validation,
    );
  }
}