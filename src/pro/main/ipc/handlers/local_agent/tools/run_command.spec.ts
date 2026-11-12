import { describe, expect, it } from "vitest";
import { normalizeCmdInvocation, resolveWindowsExeName } from "./run_command";

describe("normalizeCmdInvocation", () => {
  const run = (args: string[], exists = false) =>
    normalizeCmdInvocation("cmd", args, "win32", () => exists).args[3];

  it("leaves non-cmd commands and off-Windows calls alone", () => {
    expect(normalizeCmdInvocation("git", ["/c", "a b"], "win32")).toEqual({
      command: "git",
      args: ["/c", "a b"],
    });
    expect(normalizeCmdInvocation("cmd", ["/c", "a b"], "linux")).toEqual({
      command: "cmd",
      args: ["/c", "a b"],
    });
  });

  it("passes a single whole-command-line argument verbatim", () => {
    expect(run(["/c", "dir /b"])).toBe("dir /b");
    expect(run(["/c", "echo hello there"])).toBe("echo hello there");
  });

  it("still quotes a single spaced path that is a real file", () => {
    expect(run(["/c", "C:\\Program Files\\x.exe"], true)).toBe(
      '"C:\\Program Files\\x.exe"',
    );
  });

  it("does not add quotes to echo/set/title arguments", () => {
    expect(run(["/c", "echo", "hello world"])).toBe("echo hello world");
    expect(run(["/c", "set", "A=b c"])).toBe("set A=b c");
  });

  it("quotes spaced arguments for real programs", () => {
    expect(run(["/c", "git", "commit", "-m", "two words"])).toBe(
      'git commit -m "two words"',
    );
  });

  it("keeps arguments that already hold quotes as written", () => {
    expect(run(["/c", "git", "commit", "-m", '"two words"'])).toBe(
      'git commit -m "two words"',
    );
  });

  it("quotes a spaced program path in first position", () => {
    expect(run(["/c", "C:\\Program Files\\x.exe", "/v"])).toBe(
      '"C:\\Program Files\\x.exe" /v',
    );
  });
});

describe("resolveWindowsExeName", () => {
  const pathEnv = process.env.PATH ?? "";

  it("leaves everything alone off Windows", () => {
    expect(resolveWindowsExeName("node", "linux", pathEnv)).toBe("node");
  });

  it("leaves names with an extension or a path alone", () => {
    expect(resolveWindowsExeName("cmd.exe", "win32", pathEnv)).toBe("cmd.exe");
    expect(resolveWindowsExeName("C:\\tools\\thing", "win32", pathEnv)).toBe(
      "C:\\tools\\thing",
    );
  });

  it.skipIf(process.platform !== "win32")(
    "maps real .exe programs on PATH to their .exe name",
    () => {
      expect(resolveWindowsExeName("cmd", "win32", pathEnv)).toBe("cmd.exe");
      expect(resolveWindowsExeName("where", "win32", pathEnv)).toBe(
        "where.exe",
      );
    },
  );

  it("leaves unknown names and .cmd-only shims unchanged so the shared rule still applies", () => {
    expect(resolveWindowsExeName("definitely-not-a-program", "win32", "")).toBe(
      "definitely-not-a-program",
    );
    expect(resolveWindowsExeName("npm", "win32", "")).toBe("npm");
  });
});
