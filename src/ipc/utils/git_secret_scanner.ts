import { execGit } from "./git_utils";

const MAX_TEXT_BLOB_BYTES = 5 * 1024 * 1024;
const MAX_FINDINGS = 20;

export interface SecretFinding {
  path: string;
  line: number;
  kind: string;
}

const SECRET_PATTERNS: ReadonlyArray<{
  kind: string;
  pattern: RegExp;
}> = [
  {
    kind: "private key",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    kind: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  {
    kind: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    kind: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    kind: "Slack token",
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  },
  {
    kind: "live Stripe secret",
    pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b/g,
  },
  {
    kind: "OpenAI API key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    kind: "database URL with embedded credentials",
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:/]+:[^\s@/]+@/gi,
  },
];

const SENSITIVE_ASSIGNMENT =
  /\b((?:CLOUDFLARE|GITHUB|OPENAI|ANTHROPIC|GOOGLE|STRIPE|SLACK|AWS)_(?:API_)?(?:KEY|TOKEN|SECRET)|DATABASE_URL|CLIENT_SECRET|SERVICE_ROLE_KEY|PRIVATE_KEY|PASSWORD)\b\s*[=:]\s*["']?([^\s"',;}{]{8,})/gi;

function isSecretReference(value: string) {
  const normalized = value.toLowerCase();
  return (
    value.includes("${") ||
    normalized.includes("process.env") ||
    normalized.includes("import.meta.env") ||
    normalized.includes("secrets.") ||
    /(?:example|placeholder|dummy|changeme|change-me|your[_-]|test[_-])/.test(
      normalized,
    )
  );
}

export function scanTextForSecrets(
  path: string,
  text: string,
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { kind, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      findings.push({
        path,
        line: text.slice(0, index).split("\n").length,
        kind,
      });
      if (findings.length >= MAX_FINDINGS) return findings;
    }
  }
  SENSITIVE_ASSIGNMENT.lastIndex = 0;
  for (const match of text.matchAll(SENSITIVE_ASSIGNMENT)) {
    if (isSecretReference(match[2])) continue;
    const index = match.index ?? 0;
    findings.push({
      path,
      line: text.slice(0, index).split("\n").length,
      kind: `literal ${match[1]}`,
    });
    if (findings.length >= MAX_FINDINGS) return findings;
  }
  return findings;
}

function parseTree(output: string) {
  return output
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("\t");
      const metadata = entry.slice(0, separator).split(" ");
      return {
        type: metadata[1],
        objectId: metadata[2],
        path: entry.slice(separator + 1),
      };
    });
}

async function gitOutput(
  appPath: string,
  args: string[],
  failureMessage: string,
): Promise<string> {
  const result = await execGit(args, appPath);
  if (result.exitCode !== 0) {
    throw new Error(failureMessage);
  }
  return result.stdout;
}

/**
 * Scan every unique file snapshot reachable from commits that the next push
 * would introduce. Scanning snapshots, rather than only HEAD, catches a secret
 * that was committed and then deleted before the push.
 */
export async function scanCommitsForSecrets({
  appPath,
  branch,
}: {
  appPath: string;
  branch: string;
}): Promise<SecretFinding[]> {
  const remoteRef = `refs/remotes/origin/${branch}`;
  const remote = await execGit(["rev-parse", "--verify", remoteRef], appPath);
  const range = remote.exitCode === 0 ? `${remoteRef}..${branch}` : branch;
  const commitOutput = await gitOutput(
    appPath,
    ["rev-list", range],
    "Could not determine which commits are about to be pushed.",
  );
  const commits = commitOutput.split(/\r?\n/).filter(Boolean);
  const scannedObjects = new Set<string>();
  const findings: SecretFinding[] = [];

  for (const commit of commits) {
    const tree = parseTree(
      await gitOutput(
        appPath,
        ["ls-tree", "-r", "-z", "--full-tree", commit],
        "Could not inspect a commit before pushing.",
      ),
    );
    for (const entry of tree) {
      if (entry.type !== "blob" || scannedObjects.has(entry.objectId)) continue;
      scannedObjects.add(entry.objectId);

      const size = Number(
        await gitOutput(
          appPath,
          ["cat-file", "-s", entry.objectId],
          "Could not inspect a committed file before pushing.",
        ),
      );
      if (!Number.isFinite(size) || size > MAX_TEXT_BLOB_BYTES) continue;

      const content = await gitOutput(
        appPath,
        ["cat-file", "blob", entry.objectId],
        "Could not inspect a committed file before pushing.",
      );
      if (content.includes("\0")) continue;
      findings.push(...scanTextForSecrets(entry.path, content));
      if (findings.length >= MAX_FINDINGS)
        return findings.slice(0, MAX_FINDINGS);
    }
  }

  return findings;
}
