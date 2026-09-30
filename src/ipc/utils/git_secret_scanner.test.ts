import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit } from "./git_utils";
import {
  scanCommitsForSecrets,
  scanTextForSecrets,
} from "./git_secret_scanner";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function commit(directory: string, message: string) {
  await execGit(["add", "-A"], directory);
  const result = await execGit(
    [
      "-c",
      "user.name=Crackerbox Test",
      "-c",
      "user.email=test@crackerbox.invalid",
      "commit",
      "-m",
      message,
    ],
    directory,
  );
  expect(result.exitCode).toBe(0);
}

describe("scanTextForSecrets", () => {
  it("reports secret locations without returning the secret", () => {
    const token = `ghp_${"a".repeat(36)}`;
    const findings = scanTextForSecrets(
      "src/config.ts",
      `const harmless = true;\nconst token = "${token}";`,
    );

    expect(findings).toEqual([
      { path: "src/config.ts", line: 2, kind: "GitHub token" },
    ]);
    expect(JSON.stringify(findings)).not.toContain(token);
  });

  it("accepts GitHub Actions secret references and ordinary source", () => {
    const content = `
env:
  CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
const label = "api-key";
`;
    expect(scanTextForSecrets(".github/workflows/deploy.yml", content)).toEqual(
      [],
    );
  });

  it("detects a literal token assigned to a sensitive provider setting", () => {
    expect(
      scanTextForSecrets(
        ".dev.vars",
        "CLOUDFLARE_API_TOKEN=0123456789abcdef0123456789abcdef01234567",
      ),
    ).toEqual([
      {
        path: ".dev.vars",
        line: 1,
        kind: "literal CLOUDFLARE_API_TOKEN",
      },
    ]);
  });

  it("detects private keys and credential-bearing database URLs", () => {
    const findings = scanTextForSecrets(
      ".env",
      [
        "-----BEGIN PRIVATE KEY-----",
        "DATABASE_URL=postgres://app:hunter2@database.example/app",
      ].join("\n"),
    );

    expect(findings).toEqual([
      { path: ".env", line: 1, kind: "private key" },
      {
        path: ".env",
        line: 2,
        kind: "database URL with embedded credentials",
      },
    ]);
  });

  it("finds a secret committed and deleted before the first push", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "dyad-secret-scan-"));
    temporaryDirectories.push(directory);
    expect((await execGit(["init", "-b", "main"], directory)).exitCode).toBe(0);

    await writeFile(
      path.join(directory, "config.ts"),
      `export const token = "ghp_${"a".repeat(36)}";\n`,
    );
    await commit(directory, "add config");
    await writeFile(path.join(directory, "config.ts"), "export {};\n");
    await commit(directory, "remove token");

    expect(
      await scanCommitsForSecrets({ appPath: directory, branch: "main" }),
    ).toContainEqual({
      path: "config.ts",
      line: 1,
      kind: "GitHub token",
    });
  });
});
