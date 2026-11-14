import type { ModelMessage } from "ai";

// The clock for the entities. One quiet line that tells the model what time it
// is, added to the copy of the user's newest message that goes to the model. It is
// never saved to the chat history and never shown in the chat window.

/**
 * Fixed text for the system prompt. It never changes, so prompt caching is
 * not disturbed (the changing clock line rides on the newest message instead).
 */
export const CLOCK_SYSTEM_SENTENCE =
  "A clock line appears at the end of the user's newest message. Treat it as background. Do not mention the time or date unless it matters (a greeting at the start of a conversation, plans, deadlines, or when asked). Never open or close a reply with the time. Do not say things like 'it's late' or 'all night' unless the clock line supports it.";

/** More than this since the last message, and the line says so. */
const GAP_WORTH_MENTIONING_MS = 30 * 60 * 1000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type PartOfDay =
  | "night"
  | "early morning"
  | "morning"
  | "afternoon"
  | "evening";

function partOfDay(hour: number): PartOfDay {
  if (hour >= 21 || hour < 5) return "night";
  if (hour < 8) return "early morning";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    hour: get("hour"),
  };
}

function describeGap(ms: number): string {
  if (ms < HOUR) {
    const minutes = Math.round(ms / MINUTE);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  if (ms < DAY) {
    const hours = Math.round(ms / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.round(ms / DAY);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * The one line for the model, for example:
 * `[Clock: Friday, November 13, 2026, 8:34 PM, evening, America/New_York. About 3 hours since the user's last message. A new day began since then.]`
 *
 * `previousUserMessageAt` is when the user's message BEFORE the newest one was sent
 * (leave it out for the first message of a chat).
 */
export function clockLine(
  now: Date,
  previousUserMessageAt?: Date | null,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  // Date and time are formatted apart and joined by hand so the wording does
  // not depend on the Intl data of the Electron version.
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  const nowParts = localParts(now, timeZone);
  let line = `${day}, ${time}, ${partOfDay(nowParts.hour)}, ${timeZone}.`;

  if (previousUserMessageAt) {
    const gap = now.getTime() - previousUserMessageAt.getTime();
    if (gap > GAP_WORTH_MENTIONING_MS) {
      line += ` About ${describeGap(gap)} since the user's last message.`;
      const before = localParts(previousUserMessageAt, timeZone);
      if (before.day !== nowParts.day) {
        const slept =
          gap >= 4 * HOUR &&
          ["evening", "night"].includes(partOfDay(before.hour)) &&
          ["early morning", "morning"].includes(partOfDay(nowParts.hour));
        line += slept
          ? " A new day began since then (it was overnight)."
          : " A new day began since then.";
      }
    }
  }
  return `[Clock: ${line}]`;
}

/**
 * When the user's message before the newest one was sent, from a chat's messages
 * (oldest first, newest user message last). Undefined for a first message.
 */
export function previousUserMessageTime(
  chatMessages: ReadonlyArray<{ role: string; createdAt: Date }>,
): Date | undefined {
  const userMessages = chatMessages.filter((m) => m.role === "user");
  return userMessages.length >= 2
    ? userMessages[userMessages.length - 2].createdAt
    : undefined;
}

/**
 * Adds the clock line to the end of the newest user message in `messages`,
 * in place (the array's entry is replaced; the original message object is not
 * changed). Call it on a copy that is only sent to the model.
 */
export function addClockToLatestUserMessage(
  messages: ModelMessage[],
  line: string,
): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    if (typeof msg.content === "string") {
      messages[i] = { ...msg, content: `${msg.content}\n\n${line}` };
    } else {
      messages[i] = {
        ...msg,
        content: [...msg.content, { type: "text", text: line }],
      };
    }
    return;
  }
}

/**
 * A copy of `messages` with the clock line on the newest user message, for
 * sending to the model. `chatMessages` is the saved chat (oldest first), used
 * only to find when the user's previous message was sent. The input is not changed.
 */
export function withClockOnNewestMessage(
  messages: ModelMessage[],
  chatMessages: ReadonlyArray<{ role: string; createdAt: Date }>,
  now: Date = new Date(),
): ModelMessage[] {
  const copy = [...messages];
  addClockToLatestUserMessage(
    copy,
    clockLine(now, previousUserMessageTime(chatMessages)),
  );
  return copy;
}
