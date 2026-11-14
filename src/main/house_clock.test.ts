import { describe, expect, it } from "vitest";
import type { ModelMessage } from "ai";
import {
  addClockToLatestUserMessage,
  clockLine,
  CLOCK_SYSTEM_SENTENCE,
  previousUserMessageTime,
  withClockOnNewestMessage,
} from "./house_clock";

const NY = "America/New_York";
// 13 Nov 2026 is a Friday; New York is on standard time (UTC-5).
const at = (iso: string) => new Date(`${iso}-05:00`);

describe("clockLine", () => {
  it("names the day, date, time, part of day and time zone", () => {
    expect(clockLine(at("2026-11-13T20:34:00"), undefined, NY)).toBe(
      "[Clock: Friday, November 13, 2026, 8:34 PM, evening, America/New_York.]",
    );
  });

  it.each([
    ["2026-11-13T04:59:00", "night"],
    ["2026-11-13T05:00:00", "early morning"],
    ["2026-11-13T07:59:00", "early morning"],
    ["2026-11-13T08:00:00", "morning"],
    ["2026-11-13T11:59:00", "morning"],
    ["2026-11-13T12:00:00", "afternoon"],
    ["2026-11-13T16:59:00", "afternoon"],
    ["2026-11-13T17:00:00", "evening"],
    ["2026-11-13T20:59:00", "evening"],
    ["2026-11-13T21:00:00", "night"],
    ["2026-11-13T00:30:00", "night"],
  ])("%s is %s", (iso, word) => {
    expect(clockLine(at(iso), undefined, NY)).toContain(`, ${word}, `);
  });

  it("says nothing about the gap when it is 30 minutes or less", () => {
    const now = at("2026-11-13T20:34:00");
    const line = clockLine(now, at("2026-11-13T20:04:00"), NY);
    expect(line).not.toContain("since");
    expect(line).not.toContain("new day");
  });

  it("mentions the gap once it is past 30 minutes", () => {
    const now = at("2026-11-13T20:34:00");
    expect(clockLine(now, at("2026-11-13T20:00:00"), NY)).toContain(
      "About 34 minutes since the user's last message.",
    );
    expect(clockLine(now, at("2026-11-13T17:34:00"), NY)).toContain(
      "About 3 hours since the user's last message.",
    );
    expect(clockLine(now, at("2026-11-13T19:34:00"), NY)).toContain(
      "About 1 hour since",
    );
    expect(clockLine(now, at("2026-11-10T20:34:00"), NY)).toContain(
      "About 3 days since",
    );
  });

  it("says a new day began only when the date changed", () => {
    const now = at("2026-11-13T09:00:00");
    expect(clockLine(now, at("2026-11-13T07:00:00"), NY)).not.toContain(
      "new day",
    );
    expect(clockLine(now, at("2026-11-12T22:00:00"), NY)).toContain(
      "A new day began since then (it was overnight).",
    );
  });

  it("does not call a short crossing of midnight overnight", () => {
    const line = clockLine(
      at("2026-11-13T00:50:00"),
      at("2026-11-12T23:40:00"),
      NY,
    );
    expect(line).toContain("A new day began since then.");
    expect(line).not.toContain("overnight");
  });

  it("uses the time zone it is given", () => {
    const now = new Date("2026-11-13T02:00:00Z");
    expect(clockLine(now, undefined, "Asia/Tokyo")).toContain(
      "Friday, November 13, 2026, 11:00 AM, morning, Asia/Tokyo",
    );
    expect(clockLine(now, undefined, "America/Los_Angeles")).toContain(
      "Thursday, November 12, 2026, 6:00 PM, evening, America/Los_Angeles",
    );
  });

  it("defaults to the computer's own time zone", () => {
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(clockLine(new Date())).toContain(`, ${own}.`);
  });
});

describe("previousUserMessageTime", () => {
  const msg = (role: string, iso: string) => ({
    role,
    createdAt: new Date(iso),
  });

  it("is the user message before the newest one", () => {
    const history = [
      msg("user", "2026-11-12T10:00:00Z"),
      msg("assistant", "2026-11-12T10:01:00Z"),
      msg("user", "2026-11-12T22:00:00Z"),
      msg("assistant", "2026-11-12T22:01:00Z"),
      msg("user", "2026-11-13T09:00:00Z"),
      msg("assistant", "2026-11-13T09:00:01Z"),
    ];
    expect(previousUserMessageTime(history)).toEqual(
      new Date("2026-11-12T22:00:00Z"),
    );
  });

  it("is nothing for the first message of a chat", () => {
    expect(
      previousUserMessageTime([
        msg("user", "2026-11-13T09:00:00Z"),
        msg("assistant", "2026-11-13T09:00:01Z"),
      ]),
    ).toBeUndefined();
    expect(previousUserMessageTime([])).toBeUndefined();
  });
});

describe("addClockToLatestUserMessage", () => {
  const line = "[Clock: test]";

  it("adds the line to the end of the newest user message only", () => {
    const first: ModelMessage = { role: "user", content: "hello" };
    const reply: ModelMessage = { role: "assistant", content: "hi" };
    const newest: ModelMessage = { role: "user", content: "what now?" };
    const messages = [first, reply, newest];
    addClockToLatestUserMessage(messages, line);
    expect(messages[0]).toBe(first);
    expect(messages[1]).toBe(reply);
    expect(messages[2]).toEqual({
      role: "user",
      content: `what now?\n\n${line}`,
    });
  });

  it("does not change the original message object (so it is never saved)", () => {
    const newest: ModelMessage = { role: "user", content: "what now?" };
    const messages = [newest];
    addClockToLatestUserMessage(messages, line);
    expect(newest.content).toBe("what now?");
    expect(JSON.stringify(newest)).not.toContain("Clock");
  });

  it("appends a text part when the message already has parts", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", image: "data:image/png;base64,AAAA" },
        ],
      },
    ];
    addClockToLatestUserMessage(messages, line);
    const content = messages[0].content as Array<{ type: string }>;
    expect(content).toHaveLength(3);
    expect(content[2]).toEqual({ type: "text", text: line });
  });

  it("does nothing when there is no user message", () => {
    const messages: ModelMessage[] = [{ role: "assistant", content: "hi" }];
    addClockToLatestUserMessage(messages, line);
    expect(messages).toEqual([{ role: "assistant", content: "hi" }]);
  });
});

describe("the fixed system sentence", () => {
  it("tells the model not to announce the time", () => {
    expect(CLOCK_SYSTEM_SENTENCE).toContain("Do not mention the time or date");
    expect(CLOCK_SYSTEM_SENTENCE).toContain("Never open or close a reply");
  });
});

describe("withClockOnNewestMessage", () => {
  it("returns a stamped copy and leaves the saved messages alone", () => {
    const saved = [
      { role: "user", createdAt: new Date("2026-11-12T22:00:00Z") },
      { role: "user", createdAt: new Date("2026-11-13T14:00:00Z") },
    ];
    const toModel: ModelMessage[] = [
      { role: "user", content: "good night" },
      { role: "assistant", content: "sleep well" },
      { role: "user", content: "morning" },
    ];
    const stamped = withClockOnNewestMessage(
      toModel,
      saved,
      new Date("2026-11-13T14:05:00Z"),
    );
    expect(stamped).not.toBe(toModel);
    expect(stamped[2].content).toMatch(/^morning\n\n\[Clock: .+\]$/);
    expect(stamped[2].content).toContain("since the user's last message");
    expect(toModel[2].content).toBe("morning");
    expect(stamped[0]).toBe(toModel[0]);
  });
});
