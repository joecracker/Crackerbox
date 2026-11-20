import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import log from "electron-log";
import { db } from "@/db";
import { messages } from "@/db/schema";
import {
  readRoster,
  type Sister,
} from "@/pro/main/ipc/handlers/local_agent/house";
import type { HouseTriggerPayload } from "./house_schedule";

const logger = log.scope("house_job");

// A direct hand-off: an entity (Dextra) gives a job to a helper (Dex's laptop)
// and waits for the answer in the same turn, instead of writing it a letter.
// The job runs as an ordinary chat in the helper's own app, so every step it
// takes still asks Tim first, exactly like any other helper chat.

export const HELPER_JOB_MAX_WAIT_MS = 30 * 60_000;
const MAX_REPLY_CHARS = 12_000;

type Sender = (payload: HouseTriggerPayload) => boolean;
let windowSender: Sender | null = null;

/** main.ts hands over the function that starts a chat turn in the window. */
export function registerHouseJobSender(send: Sender | null): void {
  windowSender = send;
}

export interface HelperJobOutcome {
  chatId: number;
  success: boolean;
  pausedByStepLimit?: boolean;
}

const waiting = new Map<string, (outcome: HelperJobOutcome) => void>();

/** Called when the helper's chat turn has settled. Returns false for an unknown job. */
export function finishHelperJob(
  jobId: string,
  outcome: HelperJobOutcome,
): boolean {
  const resolve = waiting.get(jobId);
  if (!resolve) return false;
  waiting.delete(jobId);
  resolve(outcome);
  return true;
}

export function listHelpers(roster: Sister[] = readRoster()): Sister[] {
  return roster.filter((s) => s.askEveryStep);
}

export function pickHelper(
  roster: Sister[],
  wanted?: string,
): { helper?: Sister; error?: string } {
  const helpers = listHelpers(roster);
  if (helpers.length === 0) {
    return {
      error:
        "There is no helper in the house yet. Tim adds one with Add entity and the Helper box.",
    };
  }
  const ref = wanted?.trim().toLowerCase();
  if (ref) {
    const hit = helpers.find(
      (h) => h.id.toLowerCase() === ref || h.name.toLowerCase() === ref,
    );
    if (hit) return { helper: hit };
    return {
      error: `No helper called "${wanted}". Helpers: ${helpers.map((h) => h.name).join(", ")}.`,
    };
  }
  if (helpers.length === 1) return { helper: helpers[0] };
  return {
    error: `More than one helper; say which one: ${helpers.map((h) => h.name).join(", ")}.`,
  };
}

export function stripDyadTags(text: string): string {
  return text
    .replace(/<dyad-[^>]*>[\s\S]*?<\/dyad-[^>]*>/g, "")
    .replace(/<dyad-[^>]*\/>/g, "")
    .trim();
}

export function jobPrompt(input: {
  fromName: string;
  task: string;
  folder?: string;
}): string {
  const where = input.folder?.trim()
    ? `\n\nWork in this folder: ${input.folder.trim()}`
    : "";
  return `Job from ${input.fromName}, handed to you directly (not by letter). Tim approved handing it to you, and he approves each step you take.\n\nJob:\n${input.task.trim()}${where}\n\nStanding rules for every job:\n- Any number you report (counts, sizes, lines, totals) must come from a command or tool result you actually ran, never from counting by eye. If you did not measure it, write \"I did not count this\" instead of guessing.\n- Stay inside the folder named for this job and touch only what the job names. If it needs more than that, stop and say so.\n- Say plainly what you checked and what you did not.\n\nWhen you are done, make your LAST message a plain summary: what you did, which files changed, and anything left over or blocked. That last message goes straight back to ${input.fromName}. Do not send a letter for this job.`;
}

async function lastAssistantText(chatId: number): Promise<string> {
  if (!chatId) return "";
  try {
    const [row] = await db
      .select({ content: messages.content })
      .from(messages)
      .where(and(eq(messages.chatId, chatId), eq(messages.role, "assistant")))
      .orderBy(desc(messages.id))
      .limit(1);
    return stripDyadTags(row?.content ?? "").slice(0, MAX_REPLY_CHARS);
  } catch (error) {
    logger.warn("Could not read the helper's reply", error);
    return "";
  }
}

export async function runHelperJob(opts: {
  roster?: Sister[];
  helperRef?: string;
  fromName: string;
  task: string;
  folder?: string;
  signal?: AbortSignal;
  maxWaitMs?: number;
  send?: Sender | null;
  readReply?: (chatId: number) => Promise<string>;
  newId?: () => string;
}): Promise<string> {
  const picked = pickHelper(opts.roster ?? readRoster(), opts.helperRef);
  const helper = picked.helper;
  if (!helper) return picked.error ?? "There is no helper in the house yet.";
  const send = opts.send === undefined ? windowSender : opts.send;
  if (!send) {
    return "Crackerbox's window is not ready to start the helper. Try again in a moment.";
  }
  const jobId = (opts.newId ?? crypto.randomUUID)();
  const maxWaitMs = opts.maxWaitMs ?? HELPER_JOB_MAX_WAIT_MS;

  let onAbort: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = new Promise<HelperJobOutcome | "timeout" | "aborted">(
    (resolve) => {
      waiting.set(jobId, resolve);
      timer = setTimeout(() => resolve("timeout"), maxWaitMs);
      if (opts.signal) {
        if (opts.signal.aborted) resolve("aborted");
        else {
          onAbort = () => resolve("aborted");
          opts.signal.addEventListener("abort", onAbort, { once: true });
        }
      }
    },
  );

  try {
    const started = send({
      appId: helper.appId,
      sisterId: helper.id,
      prompt: jobPrompt({
        fromName: opts.fromName,
        task: opts.task,
        folder: opts.folder,
      }),
      title: `${helper.name} <- ${opts.fromName}: ${opts.task.slice(0, 40)}`,
      // Not forced on screen: Tim stays in the chat he is in. The helper's
      // chat comes to the front only when a step needs his approval.
      jobId,
    });
    if (!started) {
      return "Crackerbox's window is not ready to start the helper. Try again in a moment.";
    }
    const outcome = await result;
    if (outcome === "timeout") {
      return `Still no answer after ${Math.round(maxWaitMs / 60_000)} minutes. ${helper.name} may still be working, or waiting for Tim to approve a step in its chat. Nothing was cancelled.`;
    }
    if (outcome === "aborted") {
      return `Stopped waiting. ${helper.name} may still be running the job in its chat.`;
    }
    const reply = await (opts.readReply ?? lastAssistantText)(outcome.chatId);
    const ref = outcome.chatId ? ` (chat #${outcome.chatId})` : "";
    const body = reply || "(it wrote no summary; see its chat)";
    if (!outcome.success) {
      return `${helper.name} did not finish${ref}: the run was stopped, declined or failed. What it wrote last:\n\n${body}`;
    }
    if (outcome.pausedByStepLimit) {
      return `${helper.name} paused at its step limit${ref}. Tim can say "continue" in its chat. What it wrote last:\n\n${body}`;
    }
    return `${helper.name} finished${ref}.\n\n${body}`;
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort && opts.signal)
      opts.signal.removeEventListener("abort", onAbort);
    waiting.delete(jobId);
  }
}
