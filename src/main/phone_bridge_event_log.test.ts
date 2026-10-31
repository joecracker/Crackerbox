import { describe, expect, it } from "vitest";
import { PhoneEventLog, parseLastSeq } from "./phone_bridge_event_log";

const chunk = (chatId: number, extra: object = {}) => [{ chatId, ...extra }];

describe("PhoneEventLog", () => {
  it("numbers events from 1 and puts the number on the wire text", () => {
    const log = new PhoneEventLog();
    const a = log.record("toast:error", ["boom"]);
    const b = log.record("chat:response:end", [{ chatId: 1 }]);
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(JSON.parse(a.json)).toEqual({
      type: "event",
      channel: "toast:error",
      args: ["boom"],
      seq: 1,
    });
  });

  it("replays, in order, only what the page has not seen", () => {
    const log = new PhoneEventLog();
    for (let i = 0; i < 5; i++) log.record(`c${i}`, []);
    const r = log.since(2);
    expect(r.gap).toBe(false);
    expect(r.events.map((e) => e.seq)).toEqual([3, 4, 5]);
    expect(log.since(5)).toEqual({ gap: false, events: [] });
    expect(log.since(0).events).toHaveLength(5);
  });

  it("keeps the end of a chat stream so a missed 'done' is delivered", () => {
    const log = new PhoneEventLog();
    log.record("chat:response:chunk", chunk(7, { messages: [{ id: 1 }] }));
    const seen = log.record(
      "chat:response:chunk",
      chunk(7, { streamingPatch: {} }),
    ).seq;
    log.record("chat:response:end", chunk(7));
    const r = log.since(seen);
    expect(r.events.map((e) => e.channel)).toEqual(["chat:response:end"]);
  });

  it("drops older chunks of a chat once a full snapshot arrives, but not other chats or other channels", () => {
    const log = new PhoneEventLog();
    log.record("chat:response:chunk", chunk(7, { streamingPatch: { a: 1 } }));
    log.record("chat:response:chunk", chunk(8, { streamingPatch: { b: 1 } }));
    log.record("chat:response:end", chunk(7));
    log.record("chat:response:chunk", chunk(7, { messages: [{ id: 9 }] }));
    const channels = log.since(0).events.map((e) => `${e.channel}:${e.chatId}`);
    expect(channels).toEqual([
      "chat:response:chunk:8",
      "chat:response:end:null",
      "chat:response:chunk:7",
    ]);
  });

  it("tells the page to start over when events were let go", () => {
    const log = new PhoneEventLog(3);
    for (let i = 0; i < 6; i++) log.record(`c${i}`, []);
    expect(log.since(1).gap).toBe(true); // 2 and 3 are gone
    expect(log.since(3).gap).toBe(false); // 4,5,6 are still held
    expect(log.since(3).events.map((e) => e.seq)).toEqual([4, 5, 6]);
  });

  it("lets go of the oldest when the size limit is passed", () => {
    const log = new PhoneEventLog(1000, 400);
    for (let i = 0; i < 10; i++) log.record("big", ["x".repeat(100)]);
    expect(log.since(0).gap).toBe(true);
    expect(log.since(10).gap).toBe(false);
  });

  it("treats a number from the future as a different run: start over", () => {
    const log = new PhoneEventLog();
    log.record("a", []);
    expect(log.since(99).gap).toBe(true);
  });
});

describe("parseLastSeq", () => {
  it("reads seq from the connection address", () => {
    expect(parseLastSeq("/__phone_bridge/ws?pid=abc&seq=42")).toBe(42);
    expect(parseLastSeq("/ws?seq=0")).toBe(0);
  });
  it("is null when absent or odd", () => {
    expect(parseLastSeq("/ws?pid=abc")).toBeNull();
    expect(parseLastSeq("/ws?seq=-1")).toBeNull();
    expect(parseLastSeq("/ws?seq=abc")).toBeNull();
    expect(parseLastSeq(undefined)).toBeNull();
  });
});
