import { describe, expect, it } from "vitest";
import { assertSisterCommandAllowed, commandTouchesCrackerboxData } from "./data_folder_guard";

describe("data folder guard", () => {
  it("catches the ways a command names the data folder", () => {
    expect(commandTouchesCrackerboxData(["node.exe", "-e", "x('C:/Users/user/AppData/Roaming/Crackerbox/sqlite.db')"])).toBe(true);
    expect(commandTouchesCrackerboxData(["cmd.exe", "/c", "type C:\\Users\\user\\AppData\\Roaming\\Crackerbox\\user-settings.json"])).toBe(true);
    expect(commandTouchesCrackerboxData(["powershell", "Get-Content $env:APPDATA\\Crackerbox\\house\\x"])).toBe(true);
    expect(commandTouchesCrackerboxData(["node", "read user-settings.json"])).toBe(true);
  });
  it("leaves normal commands alone", () => {
    expect(commandTouchesCrackerboxData(["npm", "install"])).toBe(false);
    expect(commandTouchesCrackerboxData(["powershell", "Get-ChildItem C:\\Users\\user\\dyad-apps\\veritas"])).toBe(false);
  });
  it("only blocks sisters", () => {
    const parts = ["node", "C:/Users/user/AppData/Roaming/Crackerbox/sqlite.db"];
    expect(() => assertSisterCommandAllowed(true, parts)).toThrow(/never opened/);
    expect(() => assertSisterCommandAllowed(false, parts)).not.toThrow();
  });
});