import type { ModelMessage } from "ai";

// A long chat gets heavy mostly from two things she carries on every step:
// the raw output of tools she already used (whole pages, big script results)
// and her own earlier thinking. Neither is needed once the step is done: her
// answers and her notes say what mattered, and she can run a tool again.
//
// So, on every step, what she is shown is trimmed:
//   - in turns that are over: every long tool result is cut down to a short
//     head and a note, and her old thinking is dropped;
//   - in the turn she is working on: results older than the most recent few
//     are cut down the same way, in blocks (so the start of her context only
//     changes now and then, which keeps the provider's cache useful).
// The saved chat is untouched; this only changes what is sent.

export interface TrimOptions {
  /** Long results in finished turns are cut when longer than this. */
  priorTurnMaxChars: number;
  /** How much of a cut result is kept at its start. */
  keepHeadChars: number;
  /** In the current turn, the newest results kept whole. */
  inTurnKeepRecent: number;
  /** In the current turn, results are cut in blocks of this many. */
  inTurnBatch: number;
  /** In the current turn, only results longer than this are cut. */
  inTurnMaxChars: number;
}

export const DEFAULT_TRIM_OPTIONS: TrimOptions = {
  priorTurnMaxChars: 1200,
  keepHeadChars: 300,
  inTurnKeepRecent: 6,
  inTurnBatch: 6,
  inTurnMaxChars: 3000,
};

type AnyPart = Record<string, any>;

function outputLength(output: unknown): number {
  if (output == null) return 0;
  if (typeof output === "string") return output.length;
  const o = output as { type?: string; value?: unknown };
  if (o.type === "text" || o.type === "error-text") {
    return typeof o.value === "string" ? o.value.length : 0;
  }
  try {
    return JSON.stringify(o.value ?? output).length;
  } catch {
    return 0;
  }
}

function outputHead(output: unknown, max: number): string {
  const o = output as { type?: string; value?: unknown };
  const raw =
    typeof output === "string"
      ? output
      : typeof o?.value === "string"
        ? o.value
        : (() => {
            try {
              return JSON.stringify(o?.value ?? output);
            } catch {
              return "";
            }
          })();
  return raw.length > max ? raw.slice(0, max) : raw;
}

function trimmedOutput(output: unknown, keepHead: number): AnyPart {
  const length = outputLength(output);
  const head = outputHead(output, keepHead).trimEnd();
  return {
    type: "text",
    value: `${head}\n[Trimmed: this tool result was ${length} characters. Run the tool again if you need it.]`,
  };
}

/** Reasoning parts that carry provider ids must stay with their tool calls. */
function reasoningMustStay(part: AnyPart): boolean {
  const opts = part.providerOptions as Record<string, any> | undefined;
  return !!(opts?.openai?.itemId || opts?.openai?.reasoningEncryptedContent);
}

function isToolResultPart(part: AnyPart): boolean {
  return part?.type === "tool-result";
}

/**
 * Returns the messages with old tool output and old thinking cut down. Never
 * changes the order or the pairing of tool calls and their results.
 */
export function trimOldToolOutput(
  messages: ModelMessage[],
  options: Partial<TrimOptions> = {},
): ModelMessage[] {
  const o = { ...DEFAULT_TRIM_OPTIONS, ...options };

  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUser = i;
      break;
    }
  }

  // Positions of the tool results in the turn being worked on.
  const inTurn: Array<{ message: number; part: number }> = [];
  for (let i = lastUser + 1; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "tool" || !Array.isArray(m.content)) continue;
    (m.content as AnyPart[]).forEach((part, p) => {
      if (isToolResultPart(part)) inTurn.push({ message: i, part: p });
    });
  }
  const cutCount =
    Math.floor(
      Math.max(0, inTurn.length - o.inTurnKeepRecent) / o.inTurnBatch,
    ) * o.inTurnBatch;
  const cutInTurn = new Set(
    inTurn.slice(0, cutCount).map(({ message, part }) => `${message}:${part}`),
  );
  // Thinking is dropped from messages that come before the first result that
  // is still shown whole.
  const firstWholeResultMessage =
    cutCount > 0 && cutCount < inTurn.length ? inTurn[cutCount].message : -1;

  let changed = false;
  const out = messages.map((m, i) => {
    if (!Array.isArray(m.content)) return m;
    const priorTurn = i < lastUser;

    if (m.role === "assistant") {
      const dropsThinking =
        priorTurn ||
        (firstWholeResultMessage !== -1 && i < firstWholeResultMessage);
      if (!dropsThinking) return m;
      const content = (m.content as AnyPart[]).filter(
        (part) => part.type !== "reasoning" || reasoningMustStay(part),
      );
      if (content.length === (m.content as AnyPart[]).length) return m;
      changed = true;
      // A message that was only thinking would be empty; leave it out.
      return content.length ? ({ ...m, content } as ModelMessage) : null;
    }

    if (m.role === "tool") {
      let touched = false;
      const content = (m.content as AnyPart[]).map((part, p) => {
        if (!isToolResultPart(part)) return part;
        const long = outputLength(part.output);
        const cut = priorTurn
          ? long > o.priorTurnMaxChars
          : cutInTurn.has(`${i}:${p}`) && long > o.inTurnMaxChars;
        if (!cut) return part;
        touched = true;
        return { ...part, output: trimmedOutput(part.output, o.keepHeadChars) };
      });
      if (!touched) return m;
      changed = true;
      return { ...m, content } as ModelMessage;
    }

    return m;
  });

  if (!changed) return messages;
  return out.filter((m): m is ModelMessage => m !== null);
}
