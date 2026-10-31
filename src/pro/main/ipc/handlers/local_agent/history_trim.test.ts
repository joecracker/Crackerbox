import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import { trimOldToolOutput } from "./history_trim";

const big = (n: number) => "x".repeat(n);

function call(id: string, name = "read_file"): any {
  return { type: "tool-call", toolCallId: id, toolName: name, input: {} };
}
function result(id: string, value: unknown, type = "json"): any {
  return {
    type: "tool-result",
    toolCallId: id,
    toolName: "read_file",
    output: { type, value },
  };
}
const user = (text: string): ModelMessage => ({ role: "user", content: text });
const assistant = (...parts: any[]): ModelMessage => ({
  role: "assistant",
  content: parts,
});
const tool = (...parts: any[]): ModelMessage => ({
  role: "tool",
  content: parts,
});
const think = (text = "long thinking ".repeat(100)) => ({
  type: "reasoning",
  text,
});

function resultText(m: ModelMessage, i = 0): string {
  const part = (m.content as any[])[i];
  return part.output.value as string;
}

describe("trimOldToolOutput: finished turns", () => {
  it("cuts a long old tool result to a head and a note, keeps its pairing", () => {
    const msgs: ModelMessage[] = [
      user("first"),
      assistant(think(), call("a")),
      tool(result("a", { page: big(20_000) })),
      assistant({ type: "text", text: "Done, I read it." }),
      user("second"),
    ];
    const out = trimOldToolOutput(msgs);
    const trimmed = out[2];
    expect((trimmed.content as any[])[0].toolCallId).toBe("a");
    expect((trimmed.content as any[])[0].output.type).toBe("text");
    expect(resultText(trimmed)).toContain("[Trimmed: this tool result was");
    expect(resultText(trimmed)).toContain("Run the tool again");
    expect(resultText(trimmed).length).toBeLessThan(700);
  });

  it("drops her old thinking but keeps her tool calls and words", () => {
    const msgs: ModelMessage[] = [
      user("first"),
      assistant(think(), { type: "text", text: "Looking." }, call("a")),
      tool(result("a", "ok")),
      assistant(think(), { type: "text", text: "All done." }),
      user("second"),
    ];
    const out = trimOldToolOutput(msgs);
    expect((out[1].content as any[]).map((p) => p.type)).toEqual([
      "text",
      "tool-call",
    ]);
    expect((out[3].content as any[]).map((p) => p.type)).toEqual(["text"]);
  });

  it("leaves short results and user messages alone", () => {
    const msgs: ModelMessage[] = [
      user("first"),
      assistant(call("a")),
      tool(result("a", "short result")),
      assistant({ type: "text", text: "ok" }),
      user("second"),
    ];
    expect(trimOldToolOutput(msgs)).toBe(msgs);
  });

  it("keeps thinking that carries provider ids (it must stay with its tool call)", () => {
    const keep = {
      type: "reasoning",
      text: "x",
      providerOptions: { openai: { itemId: "rs_1" } },
    };
    const msgs: ModelMessage[] = [
      user("first"),
      assistant(keep, call("a")),
      tool(result("a", "ok")),
      user("second"),
    ];
    const out = trimOldToolOutput(msgs);
    expect((out[1].content as any[]).map((p) => p.type)).toEqual([
      "reasoning",
      "tool-call",
    ]);
  });

  it("works on text, error and content outputs too", () => {
    const msgs: ModelMessage[] = [
      user("first"),
      assistant(call("a"), call("b")),
      tool(result("a", big(5000), "text"), {
        ...result("b", [{ type: "text", text: big(5000) }], "content"),
      }),
      user("second"),
    ];
    const out = trimOldToolOutput(msgs);
    expect(resultText(out[2], 0)).toContain("[Trimmed");
    expect(resultText(out[2], 1)).toContain("[Trimmed");
  });
});

describe("trimOldToolOutput: the turn being worked on", () => {
  function turn(steps: number, size = 10_000): ModelMessage[] {
    const msgs: ModelMessage[] = [user("do the thing")];
    for (let i = 0; i < steps; i++) {
      msgs.push(assistant(think(), call(`c${i}`)));
      msgs.push(tool(result(`c${i}`, big(size))));
    }
    return msgs;
  }

  it("keeps everything whole while there are few results", () => {
    const msgs = turn(10);
    const out = trimOldToolOutput(msgs);
    expect(JSON.stringify(out)).toBe(JSON.stringify(msgs));
  });

  it("cuts the oldest block once there are more than keep-recent plus a block", () => {
    const msgs = turn(13); // 13 results: 13-6=7 -> one block of 6 is cut
    const out = trimOldToolOutput(msgs);
    const results = out.filter((m) => m.role === "tool");
    const cut = results.filter((m) => resultText(m).includes("[Trimmed"));
    expect(cut).toHaveLength(6);
    // the newest seven are still whole
    expect(resultText(results[results.length - 1])).not.toContain("[Trimmed");
    expect(resultText(results[0])).toContain("[Trimmed");
  });

  it("is steady: the same input gives the same output, and the cut grows only in blocks", () => {
    const counts = [];
    for (let steps = 6; steps <= 24; steps++) {
      const out = trimOldToolOutput(turn(steps));
      const again = trimOldToolOutput(turn(steps));
      expect(JSON.stringify(out)).toBe(JSON.stringify(again));
      counts.push(
        out.filter(
          (m) => m.role === "tool" && resultText(m).includes("[Trimmed"),
        ).length,
      );
    }
    // only multiples of 6, never decreasing
    for (let i = 0; i < counts.length; i++) {
      expect(counts[i] % 6).toBe(0);
      if (i > 0) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
    expect(counts.at(-1)).toBeGreaterThan(0);
  });

  it("does not cut small results in the current turn, even old ones", () => {
    const out = trimOldToolOutput(turn(30, 500));
    const results = out.filter((m) => m.role === "tool");
    expect(results).toHaveLength(30);
    expect(results.some((m) => resultText(m).includes("[Trimmed"))).toBe(false);
  });

  it("drops thinking from messages before the first whole result, keeps newer thinking", () => {
    const out = trimOldToolOutput(turn(13));
    const assistants = out.filter((m) => m.role === "assistant");
    expect(
      (assistants[0].content as any[]).some((p) => p.type === "reasoning"),
    ).toBe(false);
    expect(
      (assistants.at(-1)!.content as any[]).some((p) => p.type === "reasoning"),
    ).toBe(true);
  });

  it("never breaks tool-call and result pairing", () => {
    const out = trimOldToolOutput(turn(20));
    const calls = new Set<string>();
    const results = new Set<string>();
    for (const m of out) {
      for (const p of m.content as any[]) {
        if (p.type === "tool-call") calls.add(p.toolCallId);
        if (p.type === "tool-result") results.add(p.toolCallId);
      }
    }
    expect([...calls].sort()).toEqual([...results].sort());
  });
});
