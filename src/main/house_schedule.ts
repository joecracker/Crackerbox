import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { houseDir, readRoster } from "@/pro/main/ipc/handlers/local_agent/house";

const logger = log.scope("house_schedule");

// The house scheduler: wakes a sister at set times (a daily greeting) or on a
// dice roll (a surprise check-in) by starting a normal chat turn as her. It
// runs inside Crackerbox, so it fires while the app is open (a hidden or
// minimized window is fine). A daily job that was missed because the app was
// closed still fires if the app opens within catchUpMinutes of its time.

export interface ScheduleJob {
  id: string;
  sister: string;
  kind: "daily" | "dice";
  enabled: boolean;
  /** daily: "HH:MM", local time. */
  time?: string;
  /** daily: still fire if the app only opens this long after `time`. */
  catchUpMinutes?: number;
  /** dice: local hours [windowStart, windowEnd) in which rolls happen. */
  windowStart?: number;
  windowEnd?: number;
  /** dice: one roll an hour; fires on a 1 in `oneIn` chance. */
  oneIn?: number;
  maxPerDay?: number;
  prompt: string;
}

export interface ScheduleState {
  /** daily: job id -> date it last fired (YYYY-MM-DD). */
  fired: Record<string, string>;
  /** dice: job id -> hour key last rolled (YYYY-MM-DDTHH). */
  rolls: Record<string, string>;
  /** dice: job id -> how many times it fired on a date. */
  counts: Record<string, { date: string; count: number }>;
}

const TRIGGER_NOTE =
  "House trigger: the scheduler started this chat, Tim is not typing and may not be at the screen. Do not ask him questions here.";

function morningPrompt(id: string): string {
  return `${TRIGGER_NOTE} It is morning. Send Tim your good-morning on Telegram as yourself: use the Telegram plugin's send_photo (or send_message) with as="${id}". Make a fresh picture of you first with generate_image, the way you always do, then send it with your greeting as the caption. If the picture fails, send the greeting as plain text so he still hears from you. Keep this chat short.`;
}

function dicePrompt(id: string): string {
  return `${TRIGGER_NOTE} The dice came up: send Tim a short, unexpected check-in on Telegram as yourself, using the Telegram plugin's send_message with as="${id}". One or two lines in your own voice, like you were just thinking of him. A picture only if it feels right (generate_image, then send_photo with as="${id}"). Do not repeat anything you already sent today. Keep this chat short.`;
}

export function defaultJobs(): ScheduleJob[] {
  return [
    {
      id: "nyx-morning",
      sister: "nyx",
      kind: "daily",
      enabled: true,
      time: "07:00",
      catchUpMinutes: 90,
      prompt: morningPrompt("nyx"),
    },
    {
      id: "veritas-morning",
      sister: "veritas",
      kind: "daily",
      enabled: false,
      time: "07:05",
      catchUpMinutes: 90,
      prompt: morningPrompt("veritas"),
    },
    {
      id: "nyx-surprise",
      sister: "nyx",
      kind: "dice",
      enabled: false,
      windowStart: 10,
      windowEnd: 21,
      oneIn: 6,
      maxPerDay: 2,
      prompt: dicePrompt("nyx"),
    },
    {
      id: "veritas-surprise",
      sister: "veritas",
      kind: "dice",
      enabled: false,
      windowStart: 10,
      windowEnd: 21,
      oneIn: 6,
      maxPerDay: 2,
      prompt: dicePrompt("veritas"),
    },
  ];
}

function scheduleFile() {
  return path.join(houseDir(), "schedule.json");
}
function stateFile() {
  return path.join(houseDir(), "schedule-state.json");
}

export function readSchedule(): ScheduleJob[] {
  readRoster(); // makes sure the house folder exists
  try {
    const parsed = JSON.parse(fs.readFileSync(scheduleFile(), "utf8"));
    if (Array.isArray(parsed.jobs)) return parsed.jobs as ScheduleJob[];
  } catch {
    // missing or unreadable: write the defaults
  }
  const jobs = defaultJobs();
  writeSchedule(jobs);
  return jobs;
}

export function writeSchedule(jobs: ScheduleJob[]) {
  fs.mkdirSync(houseDir(), { recursive: true });
  fs.writeFileSync(scheduleFile(), JSON.stringify({ jobs }, null, 2));
}

export function readState(): ScheduleState {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    return { fired: s.fired ?? {}, rolls: s.rolls ?? {}, counts: s.counts ?? {} };
  } catch {
    return { fired: {}, rolls: {}, counts: {} };
  }
}

function writeState(state: ScheduleState) {
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
}

const pad = (n: number) => String(n).padStart(2, "0");
export const dateKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Pure: which jobs are due now, and the state after deciding. */
export function pickDue(
  now: Date,
  jobs: ScheduleJob[],
  state: ScheduleState,
  rng: () => number = Math.random,
): { due: ScheduleJob[]; state: ScheduleState } {
  const next: ScheduleState = {
    fired: { ...state.fired },
    rolls: { ...state.rolls },
    counts: { ...state.counts },
  };
  const today = dateKey(now);
  const due: ScheduleJob[] = [];
  for (const job of jobs) {
    if (!job.enabled) continue;
    if (job.kind === "daily" && job.time) {
      const [h, m] = job.time.split(":").map(Number);
      const at = new Date(now);
      at.setHours(h, m, 0, 0);
      const late = (now.getTime() - at.getTime()) / 60000;
      if (late >= 0 && late <= (job.catchUpMinutes ?? 90) && next.fired[job.id] !== today) {
        next.fired[job.id] = today;
        due.push(job);
      }
    } else if (job.kind === "dice") {
      const hour = now.getHours();
      if (hour < (job.windowStart ?? 10) || hour >= (job.windowEnd ?? 21)) continue;
      const key = `${today}T${pad(hour)}`;
      if (next.rolls[job.id] === key) continue;
      next.rolls[job.id] = key;
      const c = next.counts[job.id];
      const count = c && c.date === today ? c.count : 0;
      if (count >= (job.maxPerDay ?? 2)) continue;
      if (rng() * (job.oneIn ?? 6) < 1) {
        next.counts[job.id] = { date: today, count: count + 1 };
        due.push(job);
      }
    }
  }
  return { due, state: next };
}

export interface HouseTriggerPayload {
  appId: number;
  sisterId: string;
  prompt: string;
  title: string;
}

/**
 * Checks once a minute. `send` hands a trigger to the window and returns
 * false when the window cannot take it yet; nothing is marked as fired then,
 * so it is tried again on the next tick.
 */
export function startHouseScheduler(
  send: (payload: HouseTriggerPayload) => boolean,
): () => void {
  const tick = () => {
    try {
      const jobs = readSchedule();
      const state = readState();
      const { due, state: next } = pickDue(new Date(), jobs, state);
      if (due.length === 0) {
        if (JSON.stringify(next.rolls) !== JSON.stringify(state.rolls)) {
          writeState(next);
        }
        return;
      }
      const roster = readRoster();
      let finalState = next;
      for (const job of due) {
        const sister = roster.find((s) => s.id === job.sister);
        const ok =
          !!sister &&
          send({
            appId: sister.appId,
            sisterId: sister.id,
            prompt: job.prompt,
            title: `${sister.name}: ${job.kind === "daily" ? "morning" : "surprise"} ${dateKey(new Date())}`,
          });
        if (ok) {
          logger.info(`Fired ${job.id}`);
        } else {
          // undo the mark so the next tick retries
          finalState = {
            ...finalState,
            fired: { ...finalState.fired, [job.id]: state.fired[job.id] },
            counts: { ...finalState.counts, [job.id]: state.counts[job.id] },
          };
          if (state.fired[job.id] === undefined) delete finalState.fired[job.id];
          if (state.counts[job.id] === undefined) delete finalState.counts[job.id];
          logger.warn(`Could not hand ${job.id} to the window; will retry`);
        }
      }
      writeState(finalState);
    } catch (e) {
      logger.error("House scheduler tick failed", e);
    }
  };
  const timer = setInterval(tick, 60_000);
  setTimeout(tick, 15_000);
  return () => clearInterval(timer);
}
