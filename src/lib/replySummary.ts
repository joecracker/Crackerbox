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
  "dyad-ha-restart",
]);

function isFoldableTag(tag: string, attributes: Record<string, string>) {
  if (!FOLDABLE_TAGS.has(tag)) return false;
  // An error report has a button to fix it, so it stays where you can see it.
  return !(tag === "dyad-output" && attributes.type === "error");
}

// After she changes files the app adds a one-line "Checks: ..." note to the end
// of her message (see verification_ledger.ts). It is jargon, so when nothing
// failed it folds away with her working. A failed or incomplete check stays
// where you can see it.
const CHECKS_NOTE = /\n+(Checks: [^\n]*)\s*$/;

function peelChecksNote(message: string) {
  const match = CHECKS_NOTE.exec(message);
  if (!match || /\b(failed|incomplete)\b/.test(match[1])) return null;
  const rest = message.slice(0, match.index);
  if (!rest.trim()) return null;
  return { rest, note: message.slice(match.index) };
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
 * Splits a finished reply into her working and what she leaves for you to read.
 * Everything up to her last tool step folds into `work`; what comes after it
 * (her final message, plus any notice or question that needs you) stays visible
 * as `summary`. Returns null only when the reply should be shown as it is: no
 * steps to fold, a step that is still open, or something in the middle of her
 * working that needs your attention.
 */
export function splitReply(content: string): ReplySplit | null {
  if (!content.includes("<")) return null;
  const { blocks } = parseFullMessage(content);

  let lastStep = -1;
  blocks.forEach((block, index) => {
    if (
      block.kind === "custom-tag" &&
      isFoldableTag(block.tag, block.attributes)
    ) {
      lastStep = index;
    }
  });
  if (lastStep < 0) return null;

  let steps = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.kind !== "custom-tag") continue;
    if (block.inProgress) return null;
    if (i <= lastStep) {
      // A tool that failed and that she then worked past is part of her working.
      const workedPast = block.tag === "dyad-output" && i < lastStep;
      if (!workedPast && !isFoldableTag(block.tag, block.attributes))
        return null;
      if (block.tag !== "think") steps++;
    }
  }

  // Find where the last step ends in the raw text: the Nth closing tag of its
  // name, where N counts that tag's blocks up to and including this one.
  const stepBlock = blocks[lastStep];
  if (stepBlock.kind !== "custom-tag") return null;
  let nth = 0;
  for (let i = 0; i <= lastStep; i++) {
    const block = blocks[i];
    if (block.kind === "custom-tag" && block.tag === stepBlock.tag) nth++;
  }
  const closing = `</${stepBlock.tag}>`;
  let end = -1;
  for (let found = 0, from = 0; found < nth; found++) {
    const at = content.indexOf(closing, from);
    if (at < 0) return null;
    end = at + closing.length;
    from = end;
  }

  const tail = content.slice(end);
  const peeled = blocks
    .slice(lastStep + 1)
    .every((block) => block.kind === "markdown")
    ? peelChecksNote(tail)
    : null;
  return {
    work: content.slice(0, end) + (peeled ? peeled.note : ""),
    summary: (peeled ? peeled.rest : tail).trim(),
    steps,
  };
}

const baseName = (value: string) =>
  value.split(/[\\/]/).filter(Boolean).pop() || value;

/**
 * One plain line about what she is doing right now, taken from her latest step,
 * e.g. "Reading MainActivity.kt". Shown while she works instead of the steps.
 */
export function describeCurrentAction(content: string): string {
  if (!content.includes("<")) return "Working";
  const { blocks } = parseFullMessage(content);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.kind !== "custom-tag") continue;
    const a = block.attributes;
    const file = a.path ? baseName(a.path) : "";
    switch (block.tag) {
      case "think":
        return "Thinking it through";
      case "dyad-read":
        return file ? `Reading ${file}` : "Reading a file";
      case "dyad-list-files":
        return "Looking through the project";
      case "dyad-grep":
      case "dyad-code-search":
      case "dyad-explore-code":
        return a.query ? `Searching for "${a.query}"` : "Searching the code";
      case "dyad-write":
        return file ? `Writing ${file}` : "Writing a file";
      case "dyad-edit":
      case "dyad-search-replace":
        return file ? `Editing ${file}` : "Editing a file";
      case "dyad-rename":
        return "Renaming a file";
      case "dyad-delete":
        return "Removing a file";
      case "dyad-add-dependency":
        return "Adding packages";
      case "dyad-execute-sql":
        return "Running a database query";
      case "dyad-read-logs":
        return "Checking the logs";
      case "dyad-web-search":
      case "dyad-web-search-result":
        return "Searching the web";
      case "dyad-web-fetch":
        return "Reading a web page";
      case "dyad-git":
        return "Working with git";
      case "dyad-script":
        return a.description || "Running a command";
      case "dyad-status":
        return a.title || "Working";
      case "dyad-output":
        return "Working";
      default:
        if (block.tag.startsWith("dyad-ha-"))
          return "Working with Home Assistant";
        if (block.tag.startsWith("dyad-mcp-"))
          return a.tool ? `Using ${a.tool}` : "Using a tool";
        return "Working";
    }
  }
  return "Working";
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
