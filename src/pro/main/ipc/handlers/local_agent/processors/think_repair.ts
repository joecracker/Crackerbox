/**
 * Some models write their thinking as ordinary reply text and only then type a
 * closing </think>, with no opening <think>. Left alone, all of that thinking
 * shows as part of the answer. This puts the missing opening tag at the start
 * of the text run that ends in the stray closer, so the thinking is boxed like
 * any other thinking. Earlier cards (tool results) are never pulled inside it.
 */
const TAG = /<\/?think>/g;
const CARD_END = /<\/dyad-[a-z-]+>|<dyad-[a-z-]+\b[^>]*\/>/gi;

export function repairOrphanThink(text: string): string {
  if (!text.includes("</think>")) return text;
  let open = false;
  let out = text;
  let shift = 0;
  for (const m of text.matchAll(TAG)) {
    if (m[0] === "<think>") {
      open = true;
      continue;
    }
    if (open) {
      open = false;
      continue;
    }
    // Stray closer: find where its text run begins.
    const at = m.index + shift;
    const before = out.slice(0, at);
    let start = 0;
    for (const c of before.matchAll(CARD_END)) {
      start = c.index + c[0].length;
    }
    const lastThink = before.lastIndexOf("</think>");
    if (lastThink !== -1) {
      start = Math.max(start, lastThink + "</think>".length);
    }
    while (start < at && /\s/.test(out[start])) start++;
    if (start >= at) continue;
    out = `${out.slice(0, start)}<think>${out.slice(start)}`;
    shift += "<think>".length;
  }
  return out;
}
