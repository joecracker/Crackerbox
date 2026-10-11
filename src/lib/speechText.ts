/**
 * Produces the conversational prose a person would expect to hear. Chat tool
 * activity and fenced code stay visible in the message, but are intentionally
 * left out of speech.
 */
export function speechTextFromAssistantResponse(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, " ")
    .replace(/<dyad-[^>]*>[\s\S]*?<\/dyad-[^>]*>/g, " ")
    .replace(/<dyad-[^>]*\/>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(
      /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu,
      " ",
    )
    .replace(/[`*_~>#]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .trim();
}

/**
 * Keeps generation fast for long replies while preserving sentence order.
 * The first chunk can be kept shorter so speech starts sooner.
 */
export function splitSpeechText(
  text: string,
  maxLength = 420,
  firstMaxLength = maxLength,
): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  const chunks: string[] = [];
  let chunk = "";
  for (const sentence of sentences) {
    const next = sentence.trim();
    if (!next) continue;
    const limit = chunks.length === 0 ? firstMaxLength : maxLength;
    if (chunk && chunk.length + next.length + 1 > limit) {
      chunks.push(chunk);
      chunk = next;
    } else {
      chunk = `${chunk} ${next}`.trim();
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

/** Where to cut text that is too long for the room left in a chunk. */
function cutPoint(text: string, room: number) {
  const window = text.slice(0, room + 1);
  const minCut = Math.floor(room * 0.5);
  let best = -1;
  for (const match of window.matchAll(/[,;:\u2014\u2013](?=\s)/g)) {
    const end = (match.index ?? 0) + 1;
    if (end >= minCut && end <= room) best = end;
  }
  if (best > 0) return best;
  const space = window.lastIndexOf(" ");
  return space >= minCut ? space : room;
}

/**
 * Splits text for the built-in voice so that no chunk is bigger than the one
 * before it (until a minimum size). That voice makes speech at about the speed
 * it is spoken, so it can only stay ahead of playback if each chunk takes no
 * longer to make than the previous chunk takes to hear. A short sentence
 * followed by a long one used to leave seconds of silence; now the long one is
 * cut at a comma so the first chunk is filled and the later ones are smaller.
 */
export function splitSpeechIntoChunks(
  text: string,
  firstMaxLength = 90,
  decay = 0.93,
  minMaxLength = 70,
): string[] {
  const sentences = (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let limit = firstMaxLength;
  let current = "";
  const flush = () => {
    if (!current) return;
    chunks.push(current);
    current = "";
    limit = Math.max(minMaxLength, Math.floor(limit * decay));
  };
  for (const sentence of sentences) {
    let rest = sentence;
    while (rest) {
      const room = limit - (current ? current.length + 1 : 0);
      if (rest.length <= room) {
        current = current ? `${current} ${rest}` : rest;
        rest = "";
      } else if (current && current.length >= limit * 0.6) {
        // Big enough already; the sentence starts the next chunk.
        flush();
      } else {
        // Too short to stop here: fill the chunk by cutting at a natural break.
        const cut = cutPoint(rest, room);
        const head = rest.slice(0, cut).trim();
        current = current ? `${current} ${head}` : head;
        rest = rest.slice(cut).trim();
        flush();
      }
    }
  }
  flush();
  return chunks;
}
