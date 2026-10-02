/**
 * Keeps text the model types itself from being drawn as a real Crackerbox
 * card. Result cards (<dyad-status>, <dyad-write>, ...) are written by the app;
 * if the model types one, it must show as plain text, not as a fake result.
 *
 * A tag can be split across streamed chunks, so a possible partial tag at the
 * end of a chunk is held back until the next chunk (or flush).
 */
const OPEN = "<dyad-";
const CLOSE = "</dyad-";
const ZERO_WIDTH_SPACE = "\u200b";

function defuse(text: string): string {
  return text.replace(/<(\/?)dyad-/gi, `<$1${ZERO_WIDTH_SPACE}dyad-`);
}

function partialTagSuffixLength(text: string): number {
  const lower = text.toLowerCase();
  for (let len = CLOSE.length - 1; len >= 1; len--) {
    if (len > lower.length) continue;
    const tail = lower.slice(-len);
    if (
      (len <= OPEN.length - 1 && OPEN.startsWith(tail)) ||
      CLOSE.startsWith(tail)
    ) {
      return len;
    }
  }
  return 0;
}

export function createModelTextGuard() {
  let held = "";
  return {
    push(text: string): string {
      const combined = held + text;
      held = "";
      const keep = partialTagSuffixLength(combined);
      if (keep > 0) {
        held = combined.slice(-keep);
        return defuse(combined.slice(0, -keep));
      }
      return defuse(combined);
    },
    flush(): string {
      const rest = held;
      held = "";
      return defuse(rest);
    },
  };
}