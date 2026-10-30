/**
 * Text used around the handoff between chats.
 *
 * A handoff has two sides. In the old chat, the user taps "Write handoff" and
 * that chat (which did the work) saves it into the app's memory. In the new
 * chat, the user taps "New chat" and the first message is the plain line
 * below; the model sees an instruction in its place that tells it to open
 * with just a question, not a recap and not a list.
 */

/** What the user sees as the first message of a chat started from a handoff. */
export const HANDOFF_START_LINE = "Continue from the handoff.";

/** What the old chat is asked, optionally with something the user wants carried over. */
export function buildHandoffRequest(carryOver?: string): string {
  const note = carryOver?.trim();
  const base = "Write the handoff for the new chat now.";
  return note ? `${base}\n\nPlease carry this over: ${note}` : base;
}

/**
 * What the model sees on later turns in place of the start line. Shown as-is,
 * "Continue from the handoff." reads like a request to resume, and the model
 * then recaps. This tells it what the opening should look like instead.
 */
export function handoffOpeningNote(
  content: string | null | undefined,
): string | null {
  if ((content ?? "").trim() !== HANDOFF_START_LINE) return null;
  return (
    "[Handoff] This chat was started from a handoff. Your memory (state, decisions, facts) holds everything the previous chat knew; it is for you, not for the user. " +
    "Open with only the question: one to three plain sentences that ask the user what they want to do next, using the questions in your state and, where it helps, naming the options from your game plan inside the question (for example: Do you want to do this, or that?). " +
    "No bullet list, no recap of what was done before, and do not read your memory back. Do not start any work until the user answers."
  );
}
