/**
 * Catches a model that has turned into word salad: a long run of random words
 * from many different alphabets at once (English, Arabic, Russian, Thai, Hindi,
 * Chinese ...), seen on Venice's DeepSeek 1017 model on 2026-11-20 (one reply
 * ran to 133,000 characters before the user pressed Stop).
 *
 * It looks at the CONTENT, never at the length, so a very long story passes.
 * A window of text only counts as word salad when it has all of:
 *   - letters from at least three different non-Latin alphabets,
 *   - a real share of non-Latin letters,
 *   - words that keep switching between plain Latin and non-Latin.
 * Two windows in a row must look like that before the stream is stopped, so a
 * quote or a short foreign-language list never trips it.
 */

export const GIBBERISH_WINDOW_CHARS = 1200;

/** Shown in the chat (with a Continue button) when a reply is stopped. */
export const GLITCH_NOTICE_XML = `

<dyad-step-limit reason="glitch">The model started producing random words, so the reply was stopped and the good part kept. Press Continue to try again, or switch to another model.</dyad-step-limit>`;

/** Left in the model's own history so a Continue knows what happened. */
export const GLITCH_NOTE_FOR_MODEL =
  "[My previous reply started producing random words and was stopped. Pick up from the last good point.]";
const MIN_WORDS = 40;
const MIN_DISTINCT_SCRIPTS = 3;
const MIN_LETTERS_PER_SCRIPT = 4;
const MIN_NON_LATIN_LETTER_SHARE = 0.04;
const MIN_SWITCH_RATE = 0.15;
const WINDOWS_IN_A_ROW = 2;

type Script =
  | "latin"
  | "cyrillic"
  | "greek"
  | "hebrew"
  | "arabic"
  | "indic"
  | "thai"
  | "georgian"
  | "hangul"
  | "kana"
  | "han";

function scriptOf(cp: number): Script | null {
  if (
    (cp >= 0x41 && cp <= 0x5a) ||
    (cp >= 0x61 && cp <= 0x7a) ||
    (cp >= 0xc0 && cp <= 0x24f && cp !== 0xd7 && cp !== 0xf7) ||
    (cp >= 0x1e00 && cp <= 0x1eff)
  )
    return "latin";
  if (cp >= 0x400 && cp <= 0x52f) return "cyrillic";
  if (cp >= 0x370 && cp <= 0x3ff) return "greek";
  if (cp >= 0x590 && cp <= 0x5ff) return "hebrew";
  if ((cp >= 0x600 && cp <= 0x6ff) || (cp >= 0x750 && cp <= 0x77f))
    return "arabic";
  if (cp >= 0x900 && cp <= 0xdff) return "indic";
  if (cp >= 0xe00 && cp <= 0xeff) return "thai";
  if (cp >= 0x10a0 && cp <= 0x10ff) return "georgian";
  if ((cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0x1100 && cp <= 0x11ff))
    return "hangul";
  if (cp >= 0x3040 && cp <= 0x30ff) return "kana";
  if (cp >= 0x4e00 && cp <= 0x9fff) return "han";
  return null;
}

/** True when this stretch of text looks like random multi-alphabet words. */
export function looksLikeWordSalad(text: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS) return false;

  const lettersByScript = new Map<Script, number>();
  let totalLetters = 0;
  let nonLatinLetters = 0;
  let switches = 0;
  let counted = 0;
  let previousHasNonLatin: boolean | null = null;

  for (const word of words) {
    let wordHasNonLatin = false;
    let wordHasLetters = false;
    for (const ch of word) {
      const script = scriptOf(ch.codePointAt(0)!);
      if (!script) continue;
      wordHasLetters = true;
      totalLetters++;
      lettersByScript.set(script, (lettersByScript.get(script) ?? 0) + 1);
      if (script !== "latin") {
        nonLatinLetters++;
        wordHasNonLatin = true;
      }
    }
    if (!wordHasLetters) continue;
    counted++;
    if (previousHasNonLatin !== null && previousHasNonLatin !== wordHasNonLatin)
      switches++;
    previousHasNonLatin = wordHasNonLatin;
  }

  if (totalLetters === 0 || counted < MIN_WORDS) return false;

  let distinctNonLatin = 0;
  for (const [script, n] of lettersByScript) {
    if (script !== "latin" && n >= MIN_LETTERS_PER_SCRIPT) distinctNonLatin++;
  }

  return (
    distinctNonLatin >= MIN_DISTINCT_SCRIPTS &&
    nonLatinLetters / totalLetters >= MIN_NON_LATIN_LETTER_SHARE &&
    switches / Math.max(1, counted - 1) >= MIN_SWITCH_RATE
  );
}

export interface GibberishGuard {
  /**
   * Feed text as it streams. `offset` is how long the saved response was
   * before this text was added. Returns the offset to cut the saved response
   * back to once the stream has turned to word salad, otherwise null.
   */
  push(text: string, offset: number): number | null;
  readonly tripped: boolean;
}

export function createGibberishGuard(
  windowChars: number = GIBBERISH_WINDOW_CHARS,
): GibberishGuard {
  let buffer = "";
  let windowStartOffset = 0;
  let streak = 0;
  let cutAt: number | null = null;
  let tripped = false;

  return {
    push(text, offset) {
      if (tripped || !text) return tripped ? cutAt : null;
      if (buffer.length === 0) windowStartOffset = offset;
      buffer += text;
      if (buffer.length < windowChars) return null;

      const salad = looksLikeWordSalad(buffer);
      if (salad) {
        streak++;
        if (streak === 1) cutAt = windowStartOffset;
        if (streak >= WINDOWS_IN_A_ROW) {
          tripped = true;
          return cutAt;
        }
      } else {
        streak = 0;
        cutAt = null;
      }
      buffer = "";
      return null;
    },
    get tripped() {
      return tripped;
    },
  };
}
