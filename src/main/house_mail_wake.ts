import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import {
  houseDir,
  listMail,
  readMail,
  readRoster,
  type Sister,
} from "@/pro/main/ipc/handlers/local_agent/house";
import { dateKey, type HouseTriggerPayload } from "./house_schedule";

const logger = log.scope("house_mail_wake");

// Wakes a sister when another sister has written her a letter, by starting a
// normal chat turn as her (the same path the morning check-ins use). It checks
// once a minute; looking for mail is only a directory listing, so a quiet
// house costs nothing. Letters stay on disk, so nothing is lost while the app
// is closed. Only letters FROM a sister wake anyone: letters from Tim or from
// outside the front door never do. These limits only stop loops and token
// burn; they say nothing about how the sisters behave.

export interface MailWakeConfig {
  /** Tim's one pause switch. */
  enabled: boolean;
  /** sister id -> false keeps her from being woken by mail. Missing = on. */
  perSister: Record<string, boolean>;
  /** Most wakes in one back-and-forth between the same two sisters. */
  maxChain: number;
  /** A chain starts over after this many quiet minutes. */
  chainIdleMinutes: number;
  /** Most wakes per local day, in total and for any one sister. */
  dailyMax: number;
  perSisterDailyMax: number;
}

export const DEFAULT_MAIL_WAKE_CONFIG: MailWakeConfig = {
  enabled: true,
  perSister: {},
  maxChain: 4,
  chainIdleMinutes: 30,
  dailyMax: 12,
  perSisterDailyMax: 6,
};

export interface MailWakeState {
  /** The first run records letters already waiting and wakes nobody. */
  baselined: boolean;
  /** "<to>/<file>" -> ISO time it was woken for, or dropped by a limit. */
  woken: Record<string, string>;
  /** sorted pair -> wakes in the current back-and-forth. */
  chains: Record<string, { count: number; lastAt: string }>;
  /** sorted pair -> fingerprint of the last letter that woke someone. */
  lastBody: Record<string, string>;
  daily: { date: string; total: number; per: Record<string, number> };
}

export interface WakeLetter {
  to: string;
  file: string;
  fromId: string;
  fromName: string;
  subject: string;
  bodyHash: string;
}

export interface PlannedWake {
  letter: WakeLetter;
  /** The state if everything up to and including this wake is committed. */
  stateAfter: MailWakeState;
}

export function emptyMailWakeState(): MailWakeState {
  return {
    baselined: false,
    woken: {},
    chains: {},
    lastBody: {},
    daily: { date: "", total: 0, per: {} },
  };
}

export function bodyFingerprint(body: string): string {
  const norm = body.toLowerCase().replace(/\s+/g, " ").trim();
  return crypto.createHash("sha1").update(norm).digest("hex");
}

const pairKey = (a: string, b: string) => [a, b].sort().join("<>");

/** Pure: which letters should wake someone now, and the state after. */
export function pickMailWakes(
  now: Date,
  config: MailWakeConfig,
  roster: Pick<Sister, "id">[],
  letters: WakeLetter[],
  state: MailWakeState,
): { wakes: PlannedWake[]; state: MailWakeState } {
  const next: MailWakeState = structuredClone(state);
  const today = dateKey(now);
  // The first tick of a new day (not the very first ever) gives every sister
  // who is holding unread letters one wake, so nothing capped yesterday is lost.
  const rolledOver = state.daily.date !== "" && state.daily.date !== today;
  if (next.daily.date !== today)
    next.daily = { date: today, total: 0, per: {} };
  const wakes: PlannedWake[] = [];
  if (!config.enabled) return { wakes, state: next };
  const iso = now.toISOString();
  const wokeThisTick = new Set<string>();
  const sorted = [...letters].sort((a, b) => a.file.localeCompare(b.file));
  if (rolledOver) {
    const newest = new Map<string, WakeLetter>();
    for (const l of sorted) {
      if (l.fromId !== l.to && roster.some((s) => s.id === l.to)) {
        newest.set(l.to, l);
      }
    }
    for (const l of newest.values()) {
      if (config.perSister[l.to] === false) continue;
      if (
        next.daily.total >= config.dailyMax ||
        (next.daily.per[l.to] ?? 0) >= config.perSisterDailyMax
      ) {
        continue;
      }
      const pair = pairKey(l.fromId, l.to);
      next.chains[pair] = { count: 1, lastAt: iso };
      next.lastBody[pair] = l.bodyHash;
      next.daily.total += 1;
      next.daily.per[l.to] = (next.daily.per[l.to] ?? 0) + 1;
      for (const o of sorted) {
        if (o.to === l.to) next.woken[`${o.to}/${o.file}`] = iso;
      }
      wokeThisTick.add(l.to);
      wakes.push({ letter: l, stateAfter: structuredClone(next) });
    }
  }
  for (const l of sorted) {
    const key = `${l.to}/${l.file}`;
    if (next.woken[key]) continue;
    if (!roster.some((s) => s.id === l.to)) continue;
    if (l.fromId === l.to) {
      next.woken[key] = iso;
      continue;
    }
    if (config.perSister[l.to] === false) continue;
    // One wake per sister per tick; the rest wait for the next minute.
    if (wokeThisTick.has(l.to)) continue;
    const pair = pairKey(l.fromId, l.to);
    const chain = next.chains[pair];
    const idleMs = config.chainIdleMinutes * 60_000;
    const count =
      chain && now.getTime() - Date.parse(chain.lastAt) <= idleMs
        ? chain.count
        : 0;
    const drop = (why: string) => {
      next.woken[key] = iso;
      logger.info(`Mail wake dropped (${why}): ${l.fromId} -> ${l.to}`);
    };
    if (count >= config.maxChain) {
      drop("chain limit");
      continue;
    }
    if (next.lastBody[pair] === l.bodyHash) {
      drop("repeat of the last letter");
      continue;
    }
    if (
      next.daily.total >= config.dailyMax ||
      (next.daily.per[l.to] ?? 0) >= config.perSisterDailyMax
    ) {
      // Not dropped: it stays waiting and gets a wake when the day rolls over.
      continue;
    }
    next.chains[pair] = { count: count + 1, lastAt: iso };
    next.lastBody[pair] = l.bodyHash;
    next.daily.total += 1;
    next.daily.per[l.to] = (next.daily.per[l.to] ?? 0) + 1;
    next.woken[key] = iso;
    // One wake covers everything waiting for her: she opens her whole inbox.
    for (const o of sorted) {
      if (o.to === l.to && !next.woken[`${o.to}/${o.file}`]) {
        next.woken[`${o.to}/${o.file}`] = iso;
      }
    }
    wokeThisTick.add(l.to);
    wakes.push({ letter: l, stateAfter: structuredClone(next) });
  }
  return { wakes, state: next };
}

export interface WaitingLetter {
  fromName: string;
  subject: string;
  /** The letter's text. When present it can be delivered inside the wake. */
  body?: string;
}

const cleanSubject = (s: string) => s.replace(/[\r\n"]+/g, " ").slice(0, 80);
const MAX_LISTED = 8;
const MAX_DELIVERED = 8;
const MAX_LETTER_CHARS = 3000;
const MAX_TOTAL_CHARS = 14000;

/**
 * Which waiting letters have their full text put inside the wake message, in
 * the same order as `waiting`. Short ones, oldest first, up to a total size;
 * anything longer stays in the inbox for her to open with read_mail.
 */
export function selectDelivered(waiting: WaitingLetter[]): boolean[] {
  let total = 0;
  let count = 0;
  return waiting.map((l) => {
    const body = l.body?.trim();
    if (!body) return false;
    if (
      count >= MAX_DELIVERED ||
      body.length > MAX_LETTER_CHARS ||
      total + body.length > MAX_TOTAL_CHARS
    )
      return false;
    total += body.length;
    count++;
    return true;
  });
}

/**
 * What a woken sister is told. One wake covers her whole inbox (the other
 * waiting letters are marked as woken so they never wake her again), so when
 * several are waiting the prompt names every one and asks her to read them all.
 * Naming only the newest let older letters sit unread for days (2026-11-20).
 */
export function mailWakePrompt(
  fromName: string,
  subject: string,
  waiting: WaitingLetter[] = [],
): string {
  const delivered = selectDelivered(waiting);
  if (delivered.some(Boolean)) {
    const total = waiting.length;
    const inside = delivered.filter(Boolean).length;
    const blocks = waiting
      .map((l, i) =>
        delivered[i]
          ? `--- Letter ${i + 1} of ${total}, from ${l.fromName}, subject "${cleanSubject(l.subject)}" ---\n${l.body!.trim()}\n--- end of letter ${i + 1} ---`
          : null,
      )
      .filter((b): b is string => b !== null)
      .join("\n\n");
    const left = waiting
      .map((l, i) => (delivered[i] ? null : l))
      .filter((l): l is WaitingLetter => l !== null);
    const leftNote = left.length
      ? `\n\nStill waiting in your inbox (too long to include here; open each with the house tool's read_mail): ${left
          .map((l) => `from ${l.fromName}: "${cleanSubject(l.subject)}"`)
          .join("; ")}.`
      : "";
    const intro = `House trigger: ${total === 1 ? "a letter has" : `${total} letters have`} arrived for you. ${inside === total ? (total === 1 ? "Its full text is" : "The full text of each is") : `The full text of ${inside} of them is`} below${total > 1 ? ", oldest first" : ""}, so there is nothing to open: read ${total === 1 ? "it" : "them all"} now. Tim is not typing and may not be at the screen; do not ask him questions here. Answer any that need an answer with send_mail; if one needs no reply, send nothing for it. When you have dealt with ${total === 1 ? "it" : "all of them"}, end with one short line. Keep this chat short.`;
    return `${intro}\n\n${blocks}${leftNote}`;
  }
  if (waiting.length <= 1) {
    return `House trigger: a letter from ${fromName} just arrived for you ("${cleanSubject(subject)}"). Tim is not typing and may not be at the screen; do not ask him questions here. Open it with the house tool (inbox, then read_mail). If you have something to say back, send it with send_mail. If you have nothing to add, send nothing and end with one short line. Keep this chat short.`;
  }
  const listed = waiting
    .slice(0, MAX_LISTED)
    .map((l, i) => `${i + 1}. from ${l.fromName}: "${cleanSubject(l.subject)}"`)
    .join("; ");
  const more =
    waiting.length > MAX_LISTED
      ? `, and ${waiting.length - MAX_LISTED} more`
      : "";
  return `House trigger: ${waiting.length} letters are waiting for you: ${listed}${more}. Tim is not typing and may not be at the screen; do not ask him questions here. Open your inbox with the house tool and read EVERY unread letter with read_mail, oldest first, before you answer any of them. If you have something to say back, send it with send_mail. If you have nothing to add to a letter, send nothing for it. When all are read, end with one short line. Keep this chat short.`;
}

function configFile() {
  return path.join(houseDir(), "mail-wake.json");
}
function stateFile() {
  return path.join(houseDir(), "mail-wake-state.json");
}

const posInt = (v: unknown, d: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : d;

export function readMailWakeConfig(): MailWakeConfig {
  const d = DEFAULT_MAIL_WAKE_CONFIG;
  let raw: Partial<MailWakeConfig> | null = null;
  try {
    raw = JSON.parse(fs.readFileSync(configFile(), "utf8"));
  } catch {
    // missing or unreadable: write the defaults so Tim can find the file
  }
  if (!raw || typeof raw !== "object") {
    try {
      fs.mkdirSync(houseDir(), { recursive: true });
      fs.writeFileSync(configFile(), JSON.stringify(d, null, 2));
    } catch {
      // best effort
    }
    return { ...d, perSister: {} };
  }
  return {
    enabled: raw.enabled !== false,
    perSister:
      raw.perSister && typeof raw.perSister === "object" ? raw.perSister : {},
    maxChain: posInt(raw.maxChain, d.maxChain),
    chainIdleMinutes: posInt(raw.chainIdleMinutes, d.chainIdleMinutes),
    dailyMax: posInt(raw.dailyMax, d.dailyMax),
    perSisterDailyMax: posInt(raw.perSisterDailyMax, d.perSisterDailyMax),
  };
}

export function readMailWakeState(): MailWakeState {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    const e = emptyMailWakeState();
    return {
      baselined: s.baselined === true,
      woken: s.woken ?? e.woken,
      chains: s.chains ?? e.chains,
      lastBody: s.lastBody ?? e.lastBody,
      daily: s.daily ?? e.daily,
    };
  } catch {
    return emptyMailWakeState();
  }
}

function writeMailWakeState(s: MailWakeState) {
  fs.mkdirSync(houseDir(), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2));
}

/** Drop bookkeeping older than two weeks so the file stays small. */
export function pruneMailWakeState(s: MailWakeState, now: Date): MailWakeState {
  const cutoff = now.getTime() - 14 * 24 * 3600_000;
  const woken: Record<string, string> = {};
  for (const [k, v] of Object.entries(s.woken)) {
    if (Date.parse(v) >= cutoff) woken[k] = v;
  }
  return { ...s, woken };
}

/** The text of a waiting letter (without its header lines), or undefined if it cannot be read. */
export function letterBody(to: string, file: string): string | undefined {
  try {
    const text = fs.readFileSync(
      path.join(houseDir(), "mailbox", to, file),
      "utf8",
    );
    const i = text.indexOf("\n\n");
    return i >= 0 ? text.slice(i + 2) : text;
  } catch {
    return undefined;
  }
}

/** Unread letters addressed to a sister and written by a sister. */
export function collectSisterLetters(roster: Sister[]): WakeLetter[] {
  const out: WakeLetter[] = [];
  for (const to of roster) {
    for (const m of listMail(to.id)) {
      if (!m.unread) continue;
      const from = roster.find(
        (r) =>
          r.name.toLowerCase() === m.from.toLowerCase() ||
          r.id === m.from.toLowerCase(),
      );
      if (!from) continue;
      let body = "";
      try {
        const text = fs.readFileSync(
          path.join(houseDir(), "mailbox", to.id, m.file),
          "utf8",
        );
        const i = text.indexOf("\n\n");
        body = i >= 0 ? text.slice(i + 2) : text;
      } catch {
        continue;
      }
      out.push({
        to: to.id,
        file: m.file,
        fromId: from.id,
        fromName: from.name,
        subject: m.subject,
        bodyHash: bodyFingerprint(body),
      });
    }
  }
  return out;
}

/**
 * Checks once a minute. `send` hands a trigger to the window and returns
 * false when the window cannot take it yet; that wake is then not recorded and
 * is tried again on the next tick.
 */
export function startMailWake(
  send: (payload: HouseTriggerPayload) => boolean,
): () => void {
  const tick = () => {
    try {
      const config = readMailWakeConfig();
      const roster = readRoster();
      const now = new Date();
      const state = pruneMailWakeState(readMailWakeState(), now);
      const letters = collectSisterLetters(roster);
      if (!state.baselined) {
        // Letters already waiting when this first runs are not a reason to wake anyone.
        for (const l of letters)
          state.woken[`${l.to}/${l.file}`] = now.toISOString();
        state.baselined = true;
        writeMailWakeState(state);
        return;
      }
      const { wakes, state: finalState } = pickMailWakes(
        now,
        config,
        roster,
        letters,
        state,
      );
      if (wakes.length === 0) {
        if (JSON.stringify(finalState) !== JSON.stringify(state)) {
          writeMailWakeState(finalState);
        }
        return;
      }
      let committed = state;
      let failed = false;
      for (const w of wakes) {
        const sister = roster.find((s) => s.id === w.letter.to);
        // Everything waiting for her, oldest first, with each letter's text so
        // the wake itself carries them and nothing depends on her opening them.
        const waitingFor = letters
          .filter((l) => l.to === w.letter.to)
          .sort((a, b) => a.file.localeCompare(b.file));
        const waiting: WaitingLetter[] = waitingFor.map((l) => ({
          fromName: l.fromName,
          subject: l.subject,
          body: letterBody(l.to, l.file),
        }));
        const ok =
          !!sister &&
          send({
            appId: sister.appId,
            sisterId: sister.id,
            prompt: mailWakePrompt(
              w.letter.fromName,
              w.letter.subject,
              waiting,
            ),
            title: `${sister.name} <- ${w.letter.fromName}: ${w.letter.subject.slice(0, 40)}`,
          });
        if (!ok) {
          failed = true;
          logger.warn("Could not hand a mail wake to the window; will retry");
          break;
        }
        // Handed over, so the letters whose text went inside the wake are now read.
        const delivered = selectDelivered(waiting);
        waitingFor.forEach((l, i) => {
          if (!delivered[i]) return;
          try {
            readMail(l.to, l.file);
          } catch (e) {
            logger.warn(`Could not mark ${l.file} read after delivering it`, e);
          }
        });
        committed = w.stateAfter;
        logger.info(`Mail wake: ${w.letter.fromId} -> ${w.letter.to}`);
      }
      writeMailWakeState(failed ? committed : finalState);
    } catch (e) {
      logger.error("Mail wake tick failed", e);
    }
  };
  const timer = setInterval(tick, 60_000);
  setTimeout(tick, 20_000);
  return () => clearInterval(timer);
}
