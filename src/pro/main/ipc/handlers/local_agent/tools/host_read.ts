import fs from "node:fs/promises";
import path from "node:path";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  AGENT_READ_FILE_TRUNCATION_NOTICE,
  readTextFileLines,
} from "@/ipc/utils/bounded_text_file";
import { isDotenvFilePath, redactDotenvValues } from "@/utils/dotenv_redaction";

/**
 * Read-only access to files anywhere on this PC, so she can look at other
 * projects and documents without a folder being added one at a time. Two things
 * keep passwords, keys and tokens from landing in the chat (and going to the
 * AI provider): places that hold credentials are never opened, and anything that
 * looks like a secret in what is read is blanked out.
 */

const BLOCKED_DIRECTORY_NAMES = new Set([
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".azure",
  ".gcloud",
  ".docker",
  ".cloudflared",
  ".wrangler",
  "xdg.config",
]);

// Folder paths (lower case, in order) under which nothing is opened.
const BLOCKED_PATH_SEQUENCES: string[][] = [
  ["appdata", "roaming", "crackerbox"],
  ["appdata", "roaming", "claude"],
  ["appdata", "roaming", "github cli"],
  ["appdata", "roaming", "mozilla"],
  ["appdata", "roaming", "microsoft", "credentials"],
  ["appdata", "roaming", "microsoft", "protect"],
  ["appdata", "roaming", "microsoft", "vault"],
  ["appdata", "local", "microsoft", "credentials"],
  ["appdata", "local", "microsoft", "vault"],
  ["appdata", "local", "microsoft", "edge"],
  ["appdata", "local", "google", "chrome"],
  ["windows", "system32", "config"],
];

const BLOCKED_FILE_NAMES: RegExp[] = [
  /^id_(rsa|dsa|ecdsa|ed25519)/,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk|gpg|pgp)$/,
  /^\.(npmrc|pypirc|netrc|git-credentials)$/,
  /^(credentials?|secrets?)(\..+)?$/,
  /^(service[-_]?account|client[-_]?secret)/,
  /^(tokens?|auth|oauth)\.json$/,
  /^(keystore|signing)\.properties$/,
  /^(login data|cookies|web data|local state)$/,
  /^ntuser\.dat/,
  /^user-settings\.json$/,
];

export const HOST_RIPGREP_EXCLUDE_GLOBS: string[] = [
  ...[...BLOCKED_DIRECTORY_NAMES].map((name) => `!**/${name}/**`),
  "!**/AppData/Roaming/Crackerbox/**",
  "!**/AppData/Roaming/Claude/**",
  "!**/AppData/Local/Google/Chrome/**",
  "!**/AppData/Local/Microsoft/Edge/**",
  "!**/AppData/Roaming/Mozilla/**",
  "!**/id_rsa*",
  "!**/id_ed25519*",
  "!*.pem",
  "!*.key",
  "!*.p12",
  "!*.pfx",
  "!*.jks",
  "!*.keystore",
  "!*.kdbx",
  "!*.ppk",
  "!.npmrc",
  "!.netrc",
  "!.git-credentials",
  "!**/secrets.*",
  "!**/credentials*",
  "!keystore.properties",
  "!user-settings.json",
];

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[redacted private key]",
  ],
  [/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{20,}/g, "[redacted key]"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, "[redacted token]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[redacted token]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted key]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[redacted key]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[redacted token]"],
  [/\bnvapi-[A-Za-z0-9_-]{20,}/g, "[redacted key]"],
  [
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    "[redacted token]",
  ],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi, "$1[redacted]"],
  [
    /((?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|apikey|private[_-]?key|storePassword|keyPassword|client[_-]?secret|access[_-]?key)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?)([^\s"',;]{6,})/gi,
    "$1[redacted]",
  ],
];

/** Blanks out anything in `text` that looks like a password, key or token. */
export function redactSecrets(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** True when `input` is an absolute path that is not inside the open project. */
export function isHostPath(input: string, appPath: string): boolean {
  if (!input || input.startsWith("attachments:")) return false;
  if (!path.isAbsolute(input)) return false;
  const relative = path.relative(path.resolve(appPath), path.resolve(input));
  return (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

/** For an absolute path inside the project, the project-relative form. */
export function relativeInsideProject(
  input: string,
  appPath: string,
): string | undefined {
  if (!input || !path.isAbsolute(input)) return undefined;
  if (isHostPath(input, appPath)) return undefined;
  return path.relative(path.resolve(appPath), path.resolve(input)) || ".";
}

export function isBlockedHostFile(filePath: string): boolean {
  const name = path.basename(filePath).toLowerCase();
  return BLOCKED_FILE_NAMES.some((pattern) => pattern.test(name));
}

export function isBlockedHostDirectory(dirPath: string): boolean {
  const parts = path
    .resolve(dirPath)
    .toLowerCase()
    .split(/[\\/]+/)
    .filter(Boolean);
  if (parts.some((part) => BLOCKED_DIRECTORY_NAMES.has(part))) return true;
  return BLOCKED_PATH_SEQUENCES.some((sequence) => {
    for (let i = 0; i + sequence.length <= parts.length; i++) {
      if (sequence.every((segment, j) => parts[i + j] === segment)) {
        return true;
      }
    }
    return false;
  });
}

function blockedError(target: string): DyadError {
  return new DyadError(
    `"${target}" holds passwords, keys or tokens, so it is never opened. Tell Tim what you need from it instead.`,
    DyadErrorKind.Validation,
  );
}

export function assertHostPathAllowed(target: string): void {
  const resolved = path.resolve(target);
  if (
    isBlockedHostDirectory(path.dirname(resolved)) ||
    isBlockedHostDirectory(resolved) ||
    isBlockedHostFile(resolved)
  ) {
    throw blockedError(target);
  }
}

export async function hostReadFile(params: {
  filePath: string;
  startLine?: number;
  endLineInclusive?: number;
}): Promise<string> {
  const absolute = path.resolve(params.filePath);
  assertHostPathAllowed(absolute);
  let real: string;
  try {
    real = await fs.realpath(absolute);
  } catch {
    throw new DyadError(
      `File does not exist: ${params.filePath}`,
      DyadErrorKind.NotFound,
    );
  }
  // A shortcut or junction must not lead into a credentials folder.
  assertHostPathAllowed(real);

  const result = await readTextFileLines({
    rootPath: path.dirname(real),
    filePath: real,
    displayPath: params.filePath,
    startLine: params.startLine,
    endLineInclusive: params.endLineInclusive,
  });
  let content = result.content;
  if (isDotenvFilePath(real)) content = redactDotenvValues(content);
  content = redactSecrets(content);
  return result.truncated
    ? content + AGENT_READ_FILE_TRUNCATION_NOTICE
    : content;
}

const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  ".gradle",
  "build",
  ".idea",
  "__pycache__",
]);
const MAX_HOST_LIST_PATHS = 1_000;
const MAX_HOST_LIST_DEPTH = 6;

export interface HostListedPath {
  path: string;
  isDirectory: boolean;
}

/** Lists a folder anywhere on the PC. Names are shown; credential folders are not opened. */
export async function hostListDirectory(params: {
  directory: string;
  recursive: boolean;
}): Promise<{ paths: HostListedPath[]; total: number }> {
  const root = path.resolve(params.directory);
  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    throw new DyadError(
      `Directory does not exist: ${params.directory}`,
      DyadErrorKind.NotFound,
    );
  }
  if (!stat.isDirectory()) {
    throw new DyadError(
      `Not a directory: ${params.directory}`,
      DyadErrorKind.Validation,
    );
  }
  if (isBlockedHostDirectory(root)) throw blockedError(params.directory);

  const paths: HostListedPath[] = [];
  let total = 0;
  const queue: Array<{ dir: string; depth: number }> = [
    { dir: root, depth: 0 },
  ];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const isDirectory = entry.isDirectory();
      total++;
      if (paths.length < MAX_HOST_LIST_PATHS) {
        paths.push({
          path: path.relative(root, full).split(path.sep).join("/"),
          isDirectory,
        });
      }
      if (
        params.recursive &&
        isDirectory &&
        depth < MAX_HOST_LIST_DEPTH &&
        !SKIPPED_DIRECTORY_NAMES.has(entry.name.toLowerCase()) &&
        !isBlockedHostDirectory(full)
      ) {
        queue.push({ dir: full, depth: depth + 1 });
      }
    }
  }
  return { paths, total };
}
