import { describe, expect, it } from "vitest";
import { isPersonalPath, parsePersonalPaths } from "./personal_paths";

describe("parsePersonalPaths", () => {
  it("skips comments and blank lines and trims", () => {
    expect(
      parsePersonalPaths("# note\n\n  AI_RULES.md \r\npublic/library/\n"),
    ).toEqual(["AI_RULES.md", "public/library/"]);
  });

  it("normalises backslashes and a leading ./", () => {
    expect(parsePersonalPaths(".\\private\\\n./x.txt")).toEqual([
      "private/",
      "x.txt",
    ]);
  });
});

describe("isPersonalPath", () => {
  const list = ["AI_RULES.md", "public/library/", "private/"];

  it("matches an exact file only at the stated path", () => {
    expect(isPersonalPath("AI_RULES.md", list)).toBe(true);
    expect(isPersonalPath("scaffold/AI_RULES.md", list)).toBe(false);
  });

  it("matches anything under a listed folder", () => {
    expect(isPersonalPath("public/library/dextra/a.jpg", list)).toBe(true);
    expect(isPersonalPath("private/candidates/x.jpg", list)).toBe(true);
    expect(isPersonalPath("public/library", list)).toBe(true);
  });

  it("does not match lookalike names", () => {
    expect(isPersonalPath("public/libraryfoo/a.jpg", list)).toBe(false);
    expect(isPersonalPath("private-notes.md", list)).toBe(false);
  });

  it("handles Windows separators", () => {
    expect(isPersonalPath("public\\library\\a.jpg", list)).toBe(true);
  });

  it("matches nothing when the list is empty", () => {
    expect(isPersonalPath("AI_RULES.md", [])).toBe(false);
  });
});
