import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  settings: {} as { trustedHostFolders?: string[] },
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => h.settings,
  writeSettings: (patch: { trustedHostFolders?: string[] }) => {
    h.settings = { ...h.settings, ...patch };
  },
}));

import {
  getTrustedHostFolders,
  isInsideTrustedFolder,
  isTrustedHostPath,
  trustHostFolder,
  untrustHostFolder,
} from "./host_trust";

const win = process.platform === "win32";
const base = win ? "C:\\Users\\user\\sapphire" : "/home/user/sapphire";
const sep = win ? "\\" : "/";

describe("isInsideTrustedFolder", () => {
  it("matches the folder itself and anything under it", () => {
    expect(isInsideTrustedFolder(base, [base])).toBe(true);
    expect(
      isInsideTrustedFolder(`${base}${sep}plugins${sep}a.js`, [base]),
    ).toBe(true);
  });

  it("does not match a sibling that only shares the start of the name", () => {
    expect(isInsideTrustedFolder(`${base}-other${sep}a.js`, [base])).toBe(
      false,
    );
  });

  it("ignores case on Windows", () => {
    if (!win) return;
    expect(
      isInsideTrustedFolder("c:\\users\\USER\\Sapphire\\x.js", [base]),
    ).toBe(true);
  });

  it("is false with no trusted folders", () => {
    expect(isInsideTrustedFolder(base, [])).toBe(false);
  });
});

describe("trusting folders", () => {
  beforeEach(() => {
    h.settings = {};
  });

  it("remembers a folder and then trusts files under it", () => {
    expect(trustHostFolder(`${base}${sep}plugins`)).toBe(true);
    expect(
      isTrustedHostPath(`${base}${sep}plugins${sep}story${sep}x.json`),
    ).toBe(true);
    expect(isTrustedHostPath(`${base}${sep}core${sep}x.json`)).toBe(false);
  });

  it("does not add a folder that is already covered", () => {
    trustHostFolder(base);
    trustHostFolder(`${base}${sep}plugins`);
    expect(getTrustedHostFolders()).toHaveLength(1);
  });

  it("refuses to trust a drive or a whole user folder", () => {
    const broad = win
      ? ["C:\\", "C:\\Users", "C:\\Users\\user"]
      : ["/", "/home", "/home/user"];
    for (const folder of broad) expect(trustHostFolder(folder)).toBe(false);
    expect(getTrustedHostFolders()).toEqual([]);
  });

  it("can forget a folder", () => {
    trustHostFolder(base);
    untrustHostFolder(base);
    expect(getTrustedHostFolders()).toEqual([]);
  });
});
