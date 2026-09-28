import { describe, expect, it } from "vitest";
import { resolveWindowsExeName } from "./run_command";

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