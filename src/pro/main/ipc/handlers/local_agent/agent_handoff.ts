import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  MEMORY_LIMITS,
  appendToArchive,
  formatAppend,
  planFit,
  planLibrary,
  readHandoffRecord,
  readMemoryFile,
  writeHandoffRecord,
  writeLibrary,
  writeMemoryFile,
} from "./agent_memory";

// A handoff is written by the chat that did the work, just before the user
// starts a new chat. It lands in the app's memory cabinet:
//   state     replaced with: what was in progress, the game plan, the questions
//   decisions new settled decisions and dead ends are added (dated)
//   facts     new facts are added
// The new chat then starts with that memory already in front of it, and opens
// with the game plan and questions instead of a recap.

export interface HandoffInput {
  /** The chat's title, and a one-line digest of what it was about. */
  chatTitle?: string | null;
  chatSummary?: string | null;
  doingNow: string;
  gamePlan: string[];
  questions: string[];
  newDecisions?: string[];
  newFacts?: string[];
  carryOver?: string;
}

export const MAX_GAME_PLAN_ITEMS = 6;
export const MAX_QUESTIONS = 3;
export const MAX_ITEM_CHARS = 500;

function cleanList(label: string, items: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of items ?? []) {
    const item = raw
      .replace(/^\s*[-*]\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!item) continue;
    if (item.length > MAX_ITEM_CHARS) {
      throw new DyadError(
        `One ${label} is ${item.length} characters; keep each under ${MAX_ITEM_CHARS}. Shorten it and call write_handoff again. Nothing was saved.`,
        DyadErrorKind.Validation,
      );
    }
    out.push(item);
  }
  return out;
}

export function buildStateText(input: {
  doingNow: string;
  gamePlan: string[];
  questions: string[];
  carryOver?: string;
}): string {
  const parts = [
    `## Doing now\n${input.doingNow.trim()}`,
    `## Game plan (what to do next)\n${input.gamePlan.map((g) => `- ${g}`).join("\n")}`,
    `## Questions to open with\n${input.questions.map((q) => `- ${q}`).join("\n")}`,
  ];
  const carry = input.carryOver?.trim();
  if (carry) parts.push(`## Asked to carry over\n${carry}`);
  return parts.join("\n\n");
}

function sameLine(existing: string, item: string): boolean {
  const wanted = item.toLowerCase();
  return existing
    .toLowerCase()
    .split("\n")
    .some(
      (line) =>
        line.replace(/^\s*-\s*(\[\d{4}-\d{2}-\d{2}\]\s*)?/, "").trim() ===
        wanted,
    );
}

/**
 * Whether `chatId` has a handoff that is still current: it was saved by this
 * chat and the user has not written anything since. (Message times are stored
 * in whole seconds, so they can only be earlier than the real moment, never
 * later; a handoff saved after the message that asked for it always counts.)
 */
export function handoffStatus(
  appId: number,
  chatId: number,
  lastUserMessageAtMs: number,
): { saved: boolean; savedAt: number | null } {
  const record = readHandoffRecord(appId);
  if (!record || record.chatId !== chatId)
    return { saved: false, savedAt: null };
  return {
    saved: record.savedAt >= lastUserMessageAtMs,
    savedAt: record.savedAt,
  };
}

/**
 * Writes the handoff into the cabinet. Everything is checked first, so a
 * handoff that does not fit saves nothing and says what to shorten.
 */
export function writeHandoff(
  appId: number,
  chatId: number,
  input: HandoffInput,
  now: Date = new Date(),
): string {
  const doingNow = input.doingNow.trim();
  const gamePlan = cleanList("game plan item", input.gamePlan);
  const questions = cleanList("question", input.questions);
  if (doingNow.length < 10) {
    throw new DyadError(
      "doing_now needs a real description of what was in progress and the single next step. Nothing was saved.",
      DyadErrorKind.Validation,
    );
  }
  if (gamePlan.length < 1 || gamePlan.length > MAX_GAME_PLAN_ITEMS) {
    throw new DyadError(
      `game_plan needs between 1 and ${MAX_GAME_PLAN_ITEMS} short items. Nothing was saved.`,
      DyadErrorKind.Validation,
    );
  }
  if (questions.length < 1 || questions.length > MAX_QUESTIONS) {
    throw new DyadError(
      `questions needs between 1 and ${MAX_QUESTIONS} plain questions for the user. Nothing was saved.`,
      DyadErrorKind.Validation,
    );
  }

  const state = buildStateText({
    doingNow,
    gamePlan,
    questions,
    carryOver: input.carryOver,
  });
  if (state.length > MEMORY_LIMITS.state) {
    throw new DyadError(
      `The state would be ${state.length} characters; the limit is ${MEMORY_LIMITS.state}. Shorten doing_now, the game plan or the carry-over and call write_handoff again. Nothing was saved.`,
      DyadErrorKind.Validation,
    );
  }

  const decisionsBefore = readMemoryFile(appId, "decisions");
  const newDecisions = cleanList("decision", input.newDecisions).filter(
    (d) => !sameLine(decisionsBefore, d),
  );
  const decisionsAfter = newDecisions.length
    ? [decisionsBefore, formatAppend("decisions", newDecisions.join("\n"), now)]
        .filter(Boolean)
        .join("\n")
    : decisionsBefore;
  // A file that would overflow sets its oldest lines aside in an archive topic
  // instead of refusing the handoff.
  const decisionsFit = planFit("decisions", decisionsAfter);

  const factsBefore = readMemoryFile(appId, "facts");
  const newFacts = cleanList("fact", input.newFacts).filter(
    (f) => !sameLine(factsBefore, f),
  );
  const factsAfter = newFacts.length
    ? [factsBefore, newFacts.map((f) => `- ${f}`).join("\n")]
        .filter(Boolean)
        .join("\n")
    : factsBefore;
  const factsFit = planFit("facts", factsAfter);

  // Everything fits. The archives are written first (a failure there saves
  // nothing), then the files, and the record goes last, so "handoff saved" is
  // only ever true when all three files are written.
  const library = planLibrary(
    appId,
    { chatId, title: input.chatTitle, summary: input.chatSummary },
    now,
  );
  const archived: string[] = [];
  if (decisionsFit.removed.length) {
    const topic = appendToArchive(appId, "decisions", decisionsFit.removed);
    archived.push(
      `${decisionsFit.removed.length} older decision line(s) moved to topics/${topic}`,
    );
  }
  if (factsFit.removed.length) {
    const topic = appendToArchive(appId, "facts", factsFit.removed);
    archived.push(
      `${factsFit.removed.length} older fact line(s) moved to topics/${topic}`,
    );
  }
  writeLibrary(appId, library);
  if (newDecisions.length)
    writeMemoryFile(appId, "decisions", decisionsFit.text);
  if (newFacts.length) writeMemoryFile(appId, "facts", factsFit.text);
  writeMemoryFile(appId, "state", state);
  writeHandoffRecord(appId, { chatId, savedAt: now.getTime() });

  const bits = [
    "state replaced",
    newDecisions.length ? `${newDecisions.length} decision(s) added` : null,
    newFacts.length ? `${newFacts.length} fact(s) added` : null,
    "chat library updated",
    ...archived,
  ].filter(Boolean);
  return `Handoff saved (${bits.join(", ")}). Reply to the user with one short line saying the handoff is saved, and do nothing else this turn.`;
}
