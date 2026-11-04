import { describe, expect, it } from "vitest";
import { stripNullBytesFromJson } from "./strip_null_bytes";

describe("stripNullBytesFromJson", () => {
  it("removes an escaped NUL and keeps the JSON valid", () => {
    const body = JSON.stringify({ messages: [{ content: "ab\u0000cd" }] });
    const out = stripNullBytesFromJson(body);
    expect(out).not.toContain("\\u0000");
    expect(JSON.parse(out).messages[0].content).toBe("abcd");
  });

  it("removes several of them, including at the ends", () => {
    const body = JSON.stringify({ a: "\u0000x\u0000", b: ["\u0000"] });
    expect(JSON.parse(stripNullBytesFromJson(body))).toEqual({
      a: "x",
      b: [""],
    });
  });

  it("leaves the plain text u0000 after a backslash alone", () => {
    const body = JSON.stringify({ a: "type \\u0000 here" });
    expect(JSON.parse(stripNullBytesFromJson(body)).a).toBe(
      "type \\u0000 here",
    );
  });

  it("handles a real backslash right before a NUL", () => {
    const body = JSON.stringify({ a: "x\\\u0000y" });
    expect(JSON.parse(stripNullBytesFromJson(body)).a).toBe("x\\y");
  });

  it("returns clean bodies unchanged", () => {
    const body = JSON.stringify({ a: "hello" });
    expect(stripNullBytesFromJson(body)).toBe(body);
  });
});
