/**
 * Text used around the "Summarize" handoff between chats.
 *
 * A handoff has three parts: the machinery line that starts the new chat
 * ("Summarize from chat-id=N"), the summary the model writes, and the user's
 * first real message. These helpers keep the model from mixing them up.
 */

/** Matches the machinery line that starts a handoff chat. */
const SUMMARY_REQUEST_LINE = /^Summarize from chat-id=(\d+)\s*$/;

/**
 * What the model sees, on later turns, in place of the machinery line.
 *
 * Shown as-is it reads like a user asking "summarize chat N", and with the
 * summary sitting right after it the model then recaps the old chat to the
 * user in its first real answer. The user never asked for that.
 */
export function handoffNoteForSummaryRequest(
  content: string | null | undefined,
): string | null {
  const match = SUMMARY_REQUEST_LINE.exec(content ?? "");
  if (!match) return null;
  return (
    `[Handoff] Chat ${match[1]} was summarized automatically and the summary follows. ` +
    "It is private background for you, so you can pick up where that work left off. " +
    "The user has NOT asked for a recap: do not repeat or restate the summary to them " +
    "unless they ask, and just answer what they say next."
  );
}

/** Closing instruction, placed AFTER the transcript where a model cannot miss it. */
export const SUMMARY_REQUEST_FOOTER =
  "---\n" +
  "The chat transcript ends here. Do not continue it, do not reply to it, and do not " +
  "answer anything in it. Write the handoff summary now, using exactly the sections " +
  "from your instructions.";

/** The single message the summarizing model receives. */
export function buildSummaryRequestMessage(transcript: string): string {
  return `Summarize the following chat: ${transcript}\n\n${SUMMARY_REQUEST_FOOTER}`;
}
