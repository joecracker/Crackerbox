/**
 * Sent when "Build it" is tapped. It is an ordinary message, so the transcript
 * shows exactly what happened and the plan above it stays on screen.
 */
export const BUILD_IT_PROMPT = "Go ahead and build that.";

type OfferableMessage = {
  role: "user" | "assistant";
  content: string;
  commitHash?: string | null;
};

const FILE_CHANGE_TAGS =
  /<dyad-(write|edit|search-replace|delete|rename|add-dependency|command|execute-sql)\b/;

/** True when the reply already changed the project, so there is nothing left to offer. */
export function replyChangedFiles(message: OfferableMessage) {
  return Boolean(message.commitHash) || FILE_CHANGE_TAGS.test(message.content);
}

/**
 * Whether to show the "Build it" button: the last thing in the chat is an
 * assistant reply that did not change any files, and nothing else needs the
 * person's attention (a typed draft, a permission prompt, a change proposal,
 * queued messages, or a reply still being written).
 */
export function shouldOfferBuild({
  lastMessage,
  isStreaming,
  hasComposerPayload,
  hasPendingConsent,
  hasProposal,
  hasQueuedMessages,
  isEditingQueuedMessage,
}: {
  lastMessage: OfferableMessage | undefined;
  isStreaming: boolean;
  hasComposerPayload: boolean;
  hasPendingConsent: boolean;
  hasProposal: boolean;
  hasQueuedMessages: boolean;
  isEditingQueuedMessage: boolean;
}) {
  if (!lastMessage || lastMessage.role !== "assistant") return false;
  if (!lastMessage.content.trim()) return false;
  if (replyChangedFiles(lastMessage)) return false;
  return !(
    isStreaming ||
    hasComposerPayload ||
    hasPendingConsent ||
    hasProposal ||
    hasQueuedMessages ||
    isEditingQueuedMessage
  );
}
