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
