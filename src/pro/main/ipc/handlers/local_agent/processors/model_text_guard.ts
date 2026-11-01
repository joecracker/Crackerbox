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
// Stray Chinese/Japanese/Korean characters the model sometimes slips into
// English replies. Dropped from chat text (tool arguments are not affected).
const STRAY_CJK =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/g;

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

// Signs the model typed its own command or command result as plain text instead
// of making a real tool call: its raw command markup (DSML) or a made-up
// "Command finished" box. Everything from that point on is dropped, because the
// command never ran and any "result" after it is invented.
const FAKE_MARKUP = /<\s*\/?\s*[|\uff5c]*\s*DSML|<dyad-status[\s>]/i;

export function createModelTextGuard() {
  let held = "";
  let dropping = false;
  let garbled = false;
  const cut = (text: string): string => {
    if (dropping) return "";
    const m = FAKE_MARKUP.exec(text);
    if (!m) return text;
    dropping = true;
    garbled = true;
    return text.slice(0, m.index);
  };
  return {
    push(text: string): string {
      if (dropping) return "";
      const combined = held + text.replace(STRAY_CJK, "");
      held = "";
      const keep = partialTagSuffixLength(combined);
      if (keep > 0) {
        held = combined.slice(-keep);
        return defuse(cut(combined.slice(0, -keep)));
      }
      return defuse(cut(combined));
    },
    flush(): string {
      const rest = held;
      held = "";
      return defuse(cut(rest));
    },
    /** A new model step begins: stop dropping, but remember something garbled. */
    endStep(): void {
      dropping = false;
      held = "";
    },
    /** True if any text this turn was cut off as fake command markup. */
    wasGarbled(): boolean {
      return garbled;
    },
  };
}
