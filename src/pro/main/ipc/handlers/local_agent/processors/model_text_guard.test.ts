import { describe, expect, it } from "vitest";
import { createModelTextGuard } from "./model_text_guard";

const run = (parts: string[]) => {
  const guard = createModelTextGuard();
  return parts.map((p) => guard.push(p)).join("") + guard.flush();
};

describe("createModelTextGuard", () => {
  it("leaves normal text alone", () => {
    expect(run(["Hello ", "there < 3 and a<b"])).toBe(
      "Hello there < 3 and a<b",
    );
  });

  it("cuts a made-up status card and everything after it", () => {
    const guard = createModelTextGuard();
    const out =
      guard.push('Let me check. <dyad-status title="Command finished">ok') +
      guard.push("</dyad-status> and more text") +
      guard.flush();
    expect(out).toBe("Let me check. ");
    expect(guard.wasGarbled()).toBe(true);
  });

  it("cuts raw DSML command markup", () => {
    const guard = createModelTextGuard();
    const out =
      guard.push('Sure.\n<DSML parameter name="command">dir') +
      guard.push("</DSML invoke>") +
      guard.flush();
    expect(out).toBe("Sure.\n");
    expect(guard.wasGarbled()).toBe(true);
  });

  it("starts passing text again on the next step", () => {
    const guard = createModelTextGuard();
    guard.push("<DSML x>");
    guard.endStep();
    expect(guard.push("Fine now.")).toBe("Fine now.");
    expect(guard.wasGarbled()).toBe(true);
  });

  it("does not flag normal text", () => {
    const guard = createModelTextGuard();
    expect(guard.push("All good here.") + guard.flush()).toBe("All good here.");
    expect(guard.wasGarbled()).toBe(false);
  });

  it("defuses a whole fake write card", () => {
    const out = run(['<dyad-write path="a">ok</dyad-write>']);
    expect(out).not.toContain("<dyad-");
    expect(out).not.toContain("</dyad-");
  });

  it("defuses a tag split across chunks", () => {
    const out = run(["before <dya", 'd-write path="x">', "</dyad", "-write>"]);
    expect(out).not.toContain("<dyad-");
    expect(out).not.toContain("</dyad-");
    expect(out.replace(/\u200b/g, "")).toBe(
      'before <dyad-write path="x"></dyad-write>',
    );
  });

  it("releases a held partial at flush without losing it", () => {
    expect(run(["a <dya"])).toBe("a <dya");
    expect(run(["end <"])).toBe("end <");
  });

  it("is case-insensitive", () => {
    expect(run(["<DYAD-write path='x'>"])).not.toContain("<DYAD-");
  });

  it("cuts a made-up generate/output/memory tag and everything after it", () => {
    for (const tag of [
      '<dyad-generate prompt="x"></dyad-generate>',
      '<dyad-output type="text">Image saved</dyad-output>',
      '<dyad-update-memory file="a" mode="append">x</dyad-update-memory>',
      '<dyad-copy from="a" to="b" />',
      '<dyad-delete path="a" />',
    ]) {
      const guard = createModelTextGuard();
      const out =
        guard.push(`Going now.\n${tag}\nDone, it worked.`) + guard.flush();
      expect(out).toBe("Going now.\n");
      expect(guard.wasGarbled()).toBe(true);
    }
  });
});
