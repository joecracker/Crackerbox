// A phone's connection drops all the time (it goes to the camera, another app,
// sleep, or the line just goes quiet). Messages the laptop sends the phone
// while the line is down used to vanish, so a finished answer or a "may I?"
// prompt could never reach the page and she looked stuck until a refresh.
//
// Every message sent to a phone page gets a number and is kept here for a
// while. When the same page reconnects it says the last number it saw, and
// whatever came after is sent again, in order. If too much piled up and some of
// it was let go, the page is told to start over, which re-reads everything.

export const EVENT_LOG_MAX_EVENTS = 3000;
export const EVENT_LOG_MAX_BYTES = 20 * 1024 * 1024;

const CHUNK_CHANNEL = "chat:response:chunk";

export interface LoggedEvent {
  seq: number;
  /** The exact text to put on the wire. */
  json: string;
  channel: string;
  /** Set for chat stream chunks, so a full snapshot can replace older ones. */
  chatId: number | null;
}

function chunkInfo(
  channel: string,
  args: unknown[],
): { chatId: number | null; isSnapshot: boolean } {
  if (channel !== CHUNK_CHANNEL) return { chatId: null, isSnapshot: false };
  const first = args[0] as { chatId?: unknown; messages?: unknown } | undefined;
  const chatId = typeof first?.chatId === "number" ? first.chatId : null;
  return {
    chatId,
    isSnapshot: chatId !== null && Array.isArray(first?.messages),
  };
}

export class PhoneEventLog {
  private events: LoggedEvent[] = [];
  private bytes = 0;
  private nextSeq = 1;
  private evictedThrough = 0;

  constructor(
    private readonly maxEvents: number = EVENT_LOG_MAX_EVENTS,
    private readonly maxBytes: number = EVENT_LOG_MAX_BYTES,
  ) {}

  /** Numbers and keeps one event; returns it with its wire text. */
  record(channel: string, args: unknown[]): LoggedEvent {
    const seq = this.nextSeq;
    const json = JSON.stringify({ type: "event", channel, args, seq });
    this.nextSeq++;
    const { chatId, isSnapshot } = chunkInfo(channel, args);
    if (isSnapshot) {
      // A full snapshot of the chat makes every earlier chunk for it
      // redundant (patches included), so they are not kept.
      this.events = this.events.filter((e) => {
        const drop = e.channel === CHUNK_CHANNEL && e.chatId === chatId;
        if (drop) this.bytes -= e.json.length;
        return !drop;
      });
    }
    const event: LoggedEvent = { seq, json, channel, chatId };
    this.events.push(event);
    this.bytes += json.length;
    while (
      this.events.length > 1 &&
      (this.events.length > this.maxEvents || this.bytes > this.maxBytes)
    ) {
      const gone = this.events.shift()!;
      this.bytes -= gone.json.length;
      this.evictedThrough = gone.seq;
    }
    return event;
  }

  /**
   * What a page that last saw `lastSeq` missed. `gap` is true when some of it
   * can no longer be sent, so the page must start over instead.
   */
  since(lastSeq: number): { gap: boolean; events: LoggedEvent[] } {
    if (lastSeq >= this.nextSeq || lastSeq < this.evictedThrough) {
      return { gap: true, events: [] };
    }
    return { gap: false, events: this.events.filter((e) => e.seq > lastSeq) };
  }

  clear(): void {
    this.events = [];
    this.bytes = 0;
  }
}

/** The "seq" a reconnecting page reports in its connection address, if any. */
export function parseLastSeq(rawUrl: string | undefined): number | null {
  try {
    const raw = new URL(rawUrl ?? "/", "http://internal").searchParams.get(
      "seq",
    );
    if (raw === null || !/^\d{1,12}$/.test(raw)) return null;
    return Number(raw);
  } catch {
    return null;
  }
}
