import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  hostListDirectory,
  hostReadFile,
  isBlockedHostDirectory,
  isBlockedHostFile,
  isHostPath,
  redactSecrets,
} from "./host_read";

describe("redactSecrets", () => {
  it("blanks keys, tokens, private keys and password assignments", () => {
    const text = [
      "key = sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789",
      "token ghp_abcdefghijklmnopqrstuvwxyz0123",
      'storePassword = "hunter2hunter2"',
      "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
    ].join("\n");
    const out = redactSecrets(text);
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(out).not.toContain("hunter2hunter2");
    expect(out).not.toContain("MIIBOgIBAAJBAK");
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
    expect(out).toContain("storePassword");
  });

  it("leaves ordinary code and prose alone", () => {
    const text = 'val name = "Saltine"\n// open the thread list\nfun main() {}';
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("blocked places", () => {
  it("never opens credential files or folders", () => {
    expect(isBlockedHostFile("C:/p/app/keystore.jks")).toBe(true);
    expect(isBlockedHostFile("C:/Users/u/.ssh/id_ed25519")).toBe(true);
    expect(isBlockedHostFile("C:/p/secrets.yaml")).toBe(true);
    expect(isBlockedHostFile("C:/p/app/src/Main.kt")).toBe(false);
    expect(isBlockedHostDirectory("C:/Users/u/.ssh")).toBe(true);
    expect(
      isBlockedHostDirectory("C:/Users/u/AppData/Roaming/Crackerbox/x"),
    ).toBe(true);
    expect(isBlockedHostDirectory("C:/Users/u/AndroidStudioProjects")).toBe(
      false,
    );
  });
});

describe("isHostPath", () => {
  it("is true only for absolute paths outside the project", () => {
    const app = path.resolve(os.tmpdir(), "proj");
    expect(isHostPath(path.join(app, "src", "a.ts"), app)).toBe(false);
    expect(isHostPath("src/a.ts", app)).toBe(false);
    expect(isHostPath(path.resolve(os.tmpdir(), "other", "a.ts"), app)).toBe(
      true,
    );
  });
});

describe("hostReadFile and hostListDirectory", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "host-read-"));
    await fs.writeFile(
      path.join(dir, "notes.txt"),
      "hello\npassword = abc12345xyz\n",
    );
    await fs.writeFile(path.join(dir, "keystore.jks"), "binary");
    await fs.mkdir(path.join(dir, ".ssh"));
    await fs.writeFile(path.join(dir, ".ssh", "config"), "Host x");
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reads a file and blanks secrets in it", async () => {
    const out = await hostReadFile({ filePath: path.join(dir, "notes.txt") });
    expect(out).toContain("hello");
    expect(out).not.toContain("abc12345xyz");
  });

  it("refuses a keystore and anything inside a credentials folder", async () => {
    await expect(
      hostReadFile({ filePath: path.join(dir, "keystore.jks") }),
    ).rejects.toThrow(/never opened/);
    await expect(
      hostReadFile({ filePath: path.join(dir, ".ssh", "config") }),
    ).rejects.toThrow(/never opened/);
  });

  it("lists names, including the keystore, but does not open credential folders", async () => {
    const { paths } = await hostListDirectory({
      directory: dir,
      recursive: true,
    });
    const names = paths.map((p) => p.path);
    expect(names).toContain("keystore.jks");
    expect(names).toContain(".ssh");
    expect(names).not.toContain(".ssh/config");
  });
});
