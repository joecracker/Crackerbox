/**
 * Shared helpers for the ha_* Local Agent tools.
 *
 * These tools reach the user's own Home Assistant instance -- never the app
 * project -- so they intentionally sit outside `resolveDirectoryWithinAppPath`
 * / `APP_MUTATING_TOOL_NAMES`: nothing here touches `ctx.appPath` or Git, and
 * none of it should be gated behind app-blueprint approval.
 */
import path from "node:path";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings, writeSettings } from "@/main/settings";
import {
  connectSsh,
  expectFingerprint,
  trustOnFirstUse,
  type SshSession,
} from "@/ipc/utils/ssh_client";
import type { HomeAssistant } from "@/lib/schemas";

const DEFAULT_CONFIG_PATH = "/config";
const DEFAULT_SSH_PORT = 22;

const NOT_CONFIGURED_MESSAGE =
  "Home Assistant isn't connected yet. Add its connection details under Settings > Integrations > Home Assistant.";

export function getHomeAssistantSettings(): HomeAssistant {
  const ha = readSettings().homeAssistant;
  if (!ha) {
    throw new DyadError(NOT_CONFIGURED_MESSAGE, DyadErrorKind.Precondition);
  }
  return ha;
}

export function requireHaRest(ha: HomeAssistant): {
  baseUrl: string;
  token: string;
} {
  if (!ha.baseUrl || !ha.accessToken?.value) {
    throw new DyadError(
      "Home Assistant's URL and long-lived access token aren't both set. Add them under Settings > Integrations > Home Assistant.",
      DyadErrorKind.Precondition,
    );
  }
  return {
    baseUrl: ha.baseUrl.replace(/\/+$/, ""),
    token: ha.accessToken.value,
  };
}

/** GET/POST against the HA REST API. Throws a friendly DyadError on failure. */
export async function haRestFetch(
  ha: HomeAssistant,
  urlPath: string,
  init?: RequestInit,
): Promise<Response> {
  const { baseUrl, token } = requireHaRest(ha);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${urlPath}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    throw new DyadError(
      `Could not reach Home Assistant at ${baseUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      DyadErrorKind.External,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new DyadError(
      "Home Assistant rejected the access token. Generate a new long-lived access token and update it under Settings > Integrations > Home Assistant.",
      DyadErrorKind.Auth,
    );
  }
  if (!res.ok) {
    throw new DyadError(
      `Home Assistant returned ${res.status} for ${urlPath}`,
      DyadErrorKind.External,
    );
  }
  return res;
}

function requireHaSshTarget(ha: HomeAssistant): {
  host: string;
  port: number;
  username: string;
  privateKey: string;
} {
  if (!ha.sshHost || !ha.sshUsername || !ha.sshPrivateKey?.value) {
    throw new DyadError(
      "Home Assistant's SSH host, username, and private key aren't all set. Add them under Settings > Integrations > Home Assistant.",
      DyadErrorKind.Precondition,
    );
  }
  return {
    host: ha.sshHost,
    port: ha.sshPort ?? DEFAULT_SSH_PORT,
    username: ha.sshUsername,
    privateKey: ha.sshPrivateKey.value,
  };
}

export function getHaConfigRoot(ha: HomeAssistant): string {
  return ha.configPath?.trim() || DEFAULT_CONFIG_PATH;
}

/**
 * Confines a caller-supplied relative path to the HA config root. POSIX-only:
 * the HA host is always Linux (HAOS or a container), unlike the user's own
 * machine, which `resolveDirectoryWithinAppPath` has to handle both ways.
 */
export function resolveHaPath(
  configRoot: string,
  relativePath: string,
): string {
  const trimmed = relativePath.trim();
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) {
    throw new DyadError(
      `Invalid path: "${relativePath}" contains a ".." path traversal segment`,
      DyadErrorKind.Validation,
    );
  }
  const root = path.posix.resolve(configRoot);
  const resolved = path.posix.resolve(root, trimmed);
  const rel = path.posix.relative(root, resolved);
  const withinRoot =
    rel === "" ||
    (!rel.startsWith("../") && rel !== ".." && !path.posix.isAbsolute(rel));
  if (!withinRoot) {
    throw new DyadError(
      `Invalid path: "${relativePath}" escapes Home Assistant's config folder (${root})`,
      DyadErrorKind.Validation,
    );
  }
  return resolved;
}

/**
 * Opens an SSH session against Home Assistant, pinning the host key on first
 * successful connection (trust-on-first-use) and checking every later
 * connection against that pin instead of trusting again.
 */
export async function withHaSsh<T>(
  ha: HomeAssistant,
  fn: (session: SshSession) => Promise<T>,
): Promise<T> {
  const target = requireHaSshTarget(ha);
  const pinned = ha.sshHostKeyFingerprint;
  let seenFingerprint: string | null = null;
  const verifier = pinned
    ? expectFingerprint(pinned)
    : trustOnFirstUse((fp) => {
        seenFingerprint = fp;
      });
  const session = await connectSsh(target, verifier);
  try {
    if (!pinned && seenFingerprint) {
      writeSettings({
        homeAssistant: { ...ha, sshHostKeyFingerprint: seenFingerprint },
      });
    }
    return await fn(session);
  } finally {
    session.end();
  }
}

/** Runs a shell command over an open HA SSH session and throws with stderr on a nonzero exit. */
export async function runHaCommand(
  session: SshSession,
  command: string,
  options?: { input?: string; timeoutMs?: number },
): Promise<string> {
  const result = await session.run(command, options);
  if (result.code !== 0) {
    throw new DyadError(
      `Command failed on Home Assistant (exit ${result.code}): ${
        result.stderr.trim() || result.stdout.trim() || "no output"
      }`,
      DyadErrorKind.External,
    );
  }
  return result.stdout;
}

/** Retries a denied HA mutation once through passwordless sudo. */
export async function runHaCommandWithSudoFallback(
  session: SshSession,
  command: string,
  sudoCommand: string,
  options: { input?: string; timeoutMs?: number } | undefined,
  sudoDeniedMessage: string,
): Promise<string> {
  try {
    return await runHaCommand(session, command, options);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/permission denied/i.test(error.message)
    ) {
      throw error;
    }
  }

  try {
    return await runHaCommand(session, sudoCommand, options);
  } catch {
    throw new DyadError(sudoDeniedMessage, DyadErrorKind.External);
  }
}

/** Shell-quotes a single argument for the (POSIX) HA host. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
