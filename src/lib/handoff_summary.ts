/**
 * Whether a reply is really a handoff summary.
 *
 * A cheap model asked to summarize a long chat sometimes just carries the old
 * conversation on ("Short close.") instead. Length alone cannot tell the two
 * apart, so look for the section headings the summary is required to have.
 */
const REQUIRED_HEADINGS = [
  "what was done",
  "current state",
  "open problems",
  "parked ideas",
  "relevant files",
];

export function looksLikeHandoffSummary(
  content: string | null | undefined,
): boolean {
  if (!content) return false;
  const text = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (text.length < 80) return false;
  const found = REQUIRED_HEADINGS.filter((heading) =>
    new RegExp(`^\\s*(?:#{1,6}\\s*)?\\**\\s*${heading}\\b`, "im").test(text),
  );
  return found.length >= 2;
}
