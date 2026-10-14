import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePageId, ResumableSessions } from "./phone_bridge_sessions";

describe("parsePageId", () => {
  it("reads a well-formed page id from the connection address", () => {
    expect(parsePageId("/__phone_bridge/ws?pid=0123456789abcdef01234567")).toBe(
      "0123456789abcdef01234567",
    );
  });

  it("returns null when there is none or it looks wrong", () => {
    expect(parsePageId("/__phone_bridge/ws")).toBeNull();
    expect(parsePageId("/__phone_bridge/ws?pid=short")).toBeNull();
    expect(
      parsePageId("/__phone_bridge/ws?pid=has spaces and !! symbols"),
    ).toBeNull();
    expect(parsePageId(undefined)).toBeNull();
  });
});

describe("ResumableSessions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make() {
    const expired: string[] = [];
    const sessions = new ResumableSessions<{ name: string }>(1000, (v) =>
      expired.push(v.name),
    );
    return { sessions, expired };
  }

  it("makes a new session the first time and hands the same one back after", () => {
    const { sessions } = make();
    const first = sessions.acquire("page-1", () => ({ name: "a" }));
    expect(first.resumed).toBe(false);

    const again = sessions.acquire("page-1", () => ({ name: "b" }));
    expect(again.resumed).toBe(true);
    expect(again.value).toBe(first.value);
  });

  it("keeps the session through a short drop", () => {
    const { sessions, expired } = make();
    const first = sessions.acquire("page-1", () => ({ name: "a" }));
    sessions.release("page-1", first.value);

    vi.advanceTimersByTime(900);
    const back = sessions.acquire("page-1", () => ({ name: "b" }));
    expect(back.resumed).toBe(true);
    expect(back.value).toBe(first.value);

    // Coming back cancels the countdown.
    vi.advanceTimersByTime(5000);
    expect(expired).toEqual([]);
  });

  it("ends the session once the page has been gone too long", () => {
    const { sessions, expired } = make();
    const first = sessions.acquire("page-1", () => ({ name: "a" }));
    sessions.release("page-1", first.value);

    vi.advanceTimersByTime(1001);
    expect(expired).toEqual(["a"]);

    const next = sessions.acquire("page-1", () => ({ name: "b" }));
    expect(next.resumed).toBe(false);
    expect(next.value.name).toBe("b");
  });

  it("never resumes a page that did not send an id, and ends it at once", () => {
    const { sessions, expired } = make();
    const first = sessions.acquire(null, () => ({ name: "a" }));
    const second = sessions.acquire(null, () => ({ name: "b" }));
    expect(first.resumed).toBe(false);
    expect(second.resumed).toBe(false);

    sessions.release(null, first.value);
    expect(expired).toEqual(["a"]);
  });

  it("keeps different pages apart", () => {
    const { sessions } = make();
    const a = sessions.acquire("page-a", () => ({ name: "a" }));
    const b = sessions.acquire("page-b", () => ({ name: "b" }));
    expect(a.value).not.toBe(b.value);
    expect(sessions.acquire("page-b", () => ({ name: "x" })).value).toBe(
      b.value,
    );
  });

  it("restarts the countdown if a session is released twice", () => {
    const { sessions, expired } = make();
    const first = sessions.acquire("page-1", () => ({ name: "a" }));
    sessions.release("page-1", first.value);
    vi.advanceTimersByTime(800);
    sessions.release("page-1", first.value);
    vi.advanceTimersByTime(800);
    expect(expired).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(expired).toEqual(["a"]);
  });

  it("stops all countdowns when disposed", () => {
    const { sessions, expired } = make();
    const first = sessions.acquire("page-1", () => ({ name: "a" }));
    sessions.release("page-1", first.value);
    sessions.dispose();
    vi.advanceTimersByTime(5000);
    expect(expired).toEqual([]);
  });
});
