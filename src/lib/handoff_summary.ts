/**
 * Whether a reply is really a handoff summary.
 *
 * A cheap model asked to summarize a long chat sometimes just carries the old
 * conversation on ("Short close.") instead. Length alone cannot tell the two
 * apart, so look for the section headings the summary is required to have.
 */
export const REQUIRED_HANDOFF_HEADINGS = [
  "what was done",
  "current state",
  "open problems",
  "parked ideas",
  "relevant files",
] as const;

export interface HandoffSummaryInspection {
  accepted: boolean;
  foundHeadings: string[];
  missingHeadings: string[];
  length: number;
  preview: string;
}

export function inspectHandoffSummary(
  content: string | null | undefined,
): HandoffSummaryInspection {
  const raw = content ?? "";
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const foundHeadings = REQUIRED_HANDOFF_HEADINGS.filter((heading) =>
    new RegExp(`^\\s*(?:#{1,6}\\s*)?\\**\\s*${heading}\\b`, "im").test(text),
  );
  const missingHeadings = REQUIRED_HANDOFF_HEADINGS.filter(
    (heading) => !foundHeadings.includes(heading),
  );

  return {
    accepted: text.length >= 80 && foundHeadings.length >= 2,
    foundHeadings: [...foundHeadings],
    missingHeadings: [...missingHeadings],
    length: raw.length,
    preview: raw.replace(/\s+/g, " ").trim().slice(0, 300),
  };
}

export function formatHandoffSummaryRejection(
  inspection: HandoffSummaryInspection,
): string {
  const found = inspection.foundHeadings.length
    ? inspection.foundHeadings.join(", ")
    : "none";
  const missing = inspection.missingHeadings.length
    ? inspection.missingHeadings.join(", ")
    : "none";
  return (
    "The summary came back in an unexpected format, so I kept it in your chats. " +
    'Choose "Use it anyway" to open it.\n\n' +
    `Headings found (${inspection.foundHeadings.length}/5): ${found}\n` +
    `Headings missing: ${missing}\n` +
    `Reply length: ${inspection.length} characters\n` +
    `Reply preview: ${inspection.preview || "(empty reply)"}`
  );
}

export function looksLikeHandoffSummary(
  content: string | null | undefined,
): boolean {
  return inspectHandoffSummary(content).accepted;
}
