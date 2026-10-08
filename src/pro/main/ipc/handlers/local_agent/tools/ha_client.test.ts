import { describe, expect, it, vi } from "vitest";
import type { SshSession, SshResult } from "@/ipc/utils/ssh_client";
import { runHaCommandWithSudoFallback } from "./ha_client";

const success = (stdout = ""): SshResult => ({
  code: 0,
  stdout,
  stderr: "",
});

const failure = (stderr: string): SshResult => ({
  code: 1,
  stdout: "",
  stderr,
});

const cases = [
  {
    action: "write",
    command: "cat > '/config/www/test.txt'",
    sudoCommand: "sudo -n tee '/config/www/test.txt' >/dev/null",
    options: { input: "test contents" },
    deniedMessage:
      "Home Assistant denied the write, and sudo isn't allowed for this SSH user.",
  },
  {
    action: "delete",
    command: "rm -rf '/config/www/test.txt'",
    sudoCommand: "sudo -n rm -rf '/config/www/test.txt'",
    options: undefined,
    deniedMessage:
      "Home Assistant denied the delete, and sudo isn't allowed for this SSH user.",
  },
] as const;

describe.each(cases)("$action sudo fallback", (testCase) => {
  const sessionWith = (...results: SshResult[]) =>
    ({
      run: vi.fn().mockImplementation(async () => results.shift()),
      end: vi.fn(),
    }) as unknown as SshSession;

  it("returns after normal success", async () => {
    const session = sessionWith(success("done"));

    await expect(
      runHaCommandWithSudoFallback(
        session,
        testCase.command,
        testCase.sudoCommand,
        testCase.options,
        testCase.deniedMessage,
      ),
    ).resolves.toBe("done");
    expect(session.run).toHaveBeenCalledOnce();
  });

  it("retries permission denied once with sudo", async () => {
    const session = sessionWith(
      failure("zsh:1: permission denied"),
      success("done"),
    );

    await expect(
      runHaCommandWithSudoFallback(
        session,
        testCase.command,
        testCase.sudoCommand,
        testCase.options,
        testCase.deniedMessage,
      ),
    ).resolves.toBe("done");
    expect(session.run).toHaveBeenNthCalledWith(
      1,
      testCase.command,
      testCase.options,
    );
    expect(session.run).toHaveBeenNthCalledWith(
      2,
      testCase.sudoCommand,
      testCase.options,
    );
  });

  it("explains when sudo also fails", async () => {
    const session = sessionWith(
      failure("Permission denied"),
      failure("sudo: a password is required"),
    );

    await expect(
      runHaCommandWithSudoFallback(
        session,
        testCase.command,
        testCase.sudoCommand,
        testCase.options,
        testCase.deniedMessage,
      ),
    ).rejects.toThrow(testCase.deniedMessage);
    expect(session.run).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-permission error", async () => {
    const session = sessionWith(failure("connection reset"));

    await expect(
      runHaCommandWithSudoFallback(
        session,
        testCase.command,
        testCase.sudoCommand,
        testCase.options,
        testCase.deniedMessage,
      ),
    ).rejects.toThrow("connection reset");
    expect(session.run).toHaveBeenCalledOnce();
  });
});
