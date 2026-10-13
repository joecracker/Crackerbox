import { parseFullMessage } from "@/lib/streamingMessageParser";
import {
  speechTextFromAssistantResponse,
  stripSpokenNoise,
} from "@/lib/speechText";

// Steps that are only her working: reading, searching, editing, thinking.
// Anything that is not listed here (a question form, a plan, an error to fix, a
// "paused after 40 tool calls" notice, a rebuild button) is something you may
// need to act on, so a reply that has one is never folded away.
const FOLDABLE_TAGS = new Set([
  "think",
  "dyad-write",
  "dyad-generate-test",
  "dyad-edit",
  "dyad-search-replace",
  "dyad-rename",
  "dyad-copy",
  "dyad-delete",
  "dyad-add-dependency",
  "dyad-execute-sql",
  "dyad-read-logs",
  "dyad-grep",
  "dyad-explore-code",
  "dyad-codebase-context",
  "dyad-web-search-result",
  "dyad-web-search",
  "dyad-web-fetch",
  "dyad-code-search-result",
  "dyad-code-search",
  "dyad-read",
  "dyad-git",
  "dyad-mcp-tool-call",
  "dyad-mcp-tool-result",
  "dyad-mcp-tool-search",
  "dyad-mcp-tool-schema",
  "dyad-list-files",
  "dyad-database-schema",
  "dyad-db-table-schema",
  "dyad-supabase-table-schema",
  "dyad-supabase-project-info",
  "dyad-neon-project-info",
  "dyad-neon-table-schema",
  "dyad-read-guide",
  "dyad-status",
  "dyad-claude-tool",
  "dyad-image-generation",
  "dyad-script",
  "dyad-search-chats",
  "dyad-read-chat",
  "dyad-explore-chat-history",
  "dyad-test-assertions",
  "dyad-output",
  "dyad-ha-write-file",
  "dyad-ha-delete-file",
  "dyad-ha-read-file",
  "dyad-ha-list-files",
  "dyad-ha-list-entities",
]);

function isFoldableTag(tag: string, attributes: Record<string, string>) {
  if (!FOLDABLE_TAGS.has(tag)) return false;
  // An error report has a button to fix it, so it stays where you can see it.
  return !(tag === "dyad-output" && attributes.type === "error");
}

export interface ReplySplit {
  /** Everything before her final message: narration, thinking, tool steps. */
  work: string;
  /** Her final message, the part after her last step. */
  summary: string;
  /** How many tool steps are folded into `work`. */
  steps: number;
}

/**
 * Splits a finished reply into her working and her final message. Returns null
 * when the reply should just be shown as it is: no steps to fold, it ends on a
 * step instead of a message, something in it needs your attention, or the
 * stream is still open.
 */
export function splitReply(content: string): ReplySplit | null {
  if (!content.includes("<")) return null;
  const { blocks } = parseFullMessage(content);
  const last = blocks.at(-1);
  if (!last || last.kind !== "markdown" || !last.content.trim()) return null;
  const work = blocks.slice(0, -1);
  if (work.length === 0) return null;

  let steps = 0;
  for (const block of work) {
    if (block.kind !== "custom-tag") continue;
    if (block.inProgress || !isFoldableTag(block.tag, block.attributes)) {
      return null;
    }
    if (block.tag !== "think") steps++;
  }
  if (!content.endsWith(last.content)) return null;

  return {
    work: content.slice(0, content.length - last.content.length),
    summary: last.content.trim(),
    steps,
  };
}

/**
 * True while a reply is still being worked on and has nothing that needs your
 * attention yet, so the chat can show a working indicator instead of a stream
 * of narration.
 */
export function isWorkInProgress(content: string): boolean {
  if (!content.includes("<")) return false;
  const { blocks } = parseFullMessage(content);
  let sawStep = false;
  for (const block of blocks) {
    if (block.kind !== "custom-tag") continue;
    if (!isFoldableTag(block.tag, block.attributes)) return false;
    sawStep = true;
  }
  return sawStep;
}

/** What the voice reads: exactly what the chat shows, minus links and file paths. */
export function spokenTextForReply(
  content: string,
  summaryView: boolean,
): string {
  const split = summaryView ? splitReply(content) : null;
  return stripSpokenNoise(
    speechTextFromAssistantResponse(split ? split.summary : content),
  );
}
