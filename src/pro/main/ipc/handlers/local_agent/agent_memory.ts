import fs from "node:fs";
import path from "node:path";
import { getUserDataPath } from "@/paths/paths";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

// CB's memory for one app: a small filing cabinet that lives in Crackerbox's
// data folder (not inside the project, so it never rides along into GitHub).
//
//   state.md      what is being worked on right now and the single next step
//   decisions.md  settled decisions and dead ends (do not redo)
//   facts.md      where things live, how things are started, gotchas
//   topics/*.md   anything longer, read on demand; the first line says what it is
//
// The three core files are shown to her at the start of every turn together
// with an index of everything in the cabinet. Topic files are opened with
// read_memory. She changes the cabinet with update_memory, one section at a
// time, so a small fix can never wipe the rest.

export const CORE_MEMORY_FILES = ["state", "decisions", "facts"] as const;
export type CoreMemoryFile = (typeof CORE_MEMORY_FILES)[number];

export const MEMORY_LIMITS: Record<CoreMemoryFile, number> = {
  state: 6000,
  decisions: 5000,
  facts: 5000,
};
export const TOPIC_LIMIT = 8000;
export const MAX_TOPICS = 20;

const CORE_PURPOSE: Record<CoreMemoryFile, string> = {
  state: "what is being worked on right now and the single next step",
  decisions: "settled decisions and dead ends (do not redo)",
  facts: "where things live, how things are started, gotchas",
};

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type MemoryMode = "append" | "replace_section" | "replace_file";

export function isCoreMemoryFile(name: string): name is CoreMemoryFile {
  return (CORE_MEMORY_FILES as readonly string[]).includes(name);
}

export function agentMemoryDir(appId: number): string {
  return path.join(getUserDataPath(), "agent-memory", `app-${appId}`);
}

/** Lower-cases the name, drops a trailing ".md" and rejects anything odd. */
export function normalizeMemoryName(raw: string): string {
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/^topics\//, "")
    .replace(/\.md$/, "");
  if (!NAME_PATTERN.test(name)) {
    throw new DyadError(
      `"${raw}" is not a valid memory file name. Use state, decisions, facts, or a topic name made of lowercase letters, digits and dashes (up to 40 characters).`,
      DyadErrorKind.Validation,
    );
  }
  return name;
}

function memoryFilePath(appId: number, name: string): string {
  const dir = agentMemoryDir(appId);
  return isCoreMemoryFile(name)
    ? path.join(dir, `${name}.md`)
    : path.join(dir, "topics", `${name}.md`);
}

function limitFor(name: string): number {
  return isCoreMemoryFile(name) ? MEMORY_LIMITS[name] : TOPIC_LIMIT;
}

export function readMemoryFile(appId: number, rawName: string): string {
  const name = normalizeMemoryName(rawName);
  try {
    return fs.readFileSync(memoryFilePath(appId, name), "utf8").trim();
  } catch {
    return "";
  }
}

export function listTopicFiles(appId: number): string[] {
  try {
    return fs
      .readdirSync(path.join(agentMemoryDir(appId), "topics"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3))
      .filter((n) => NAME_PATTERN.test(n))
      .sort();
  } catch {
    return [];
  }
}

function describeTopic(text: string): string {
  const first = text.split("\n").find((l) => l.trim()) ?? "";
  return (
    first
      .replace(/^#+\s*/, "")
      .trim()
      .slice(0, 120) || "(no description)"
  );
}

export function writeMemoryFile(
  appId: number,
  name: string,
  text: string,
): void {
  const file = memoryFilePath(appId, name);
  const trimmed = text.trim();
  if (!trimmed) {
    fs.rmSync(file, { force: true });
    return;
  }
  const limit = limitFor(name);
  if (trimmed.length > limit) {
    throw new DyadError(
      `That would make ${name} ${trimmed.length} characters; the limit is ${limit}. Condense it first (merge lines, drop stale ones, or move long detail into a topic file) and try again. Nothing was saved.`,
      DyadErrorKind.Validation,
    );
  }
  if (!isCoreMemoryFile(name) && !fs.existsSync(file)) {
    if (listTopicFiles(appId).length >= MAX_TOPICS) {
      throw new DyadError(
        `There are already ${MAX_TOPICS} topic files. Merge or clear one before adding another. Nothing was saved.`,
        DyadErrorKind.Validation,
      );
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write beside the file and rename, so a crash can never leave half a file.
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${trimmed}\n`);
  fs.renameSync(temp, file);
}

function headingLevel(line: string): number {
  const m = /^(#{1,6})\s+\S/.exec(line.trim());
  return m ? m[1].length : 0;
}

/** Replaces the body of the section under `heading`; adds it if missing. */
function replaceSection(existing: string, heading: string, body: string) {
  const wanted = heading.trim();
  const level = headingLevel(wanted);
  if (!level) {
    throw new DyadError(
      'replace_section needs a heading line that starts with "#", for example "## Red batch".',
      DyadErrorKind.Validation,
    );
  }
  const lines = existing ? existing.split("\n") : [];
  const start = lines.findIndex(
    (l) => l.trim().toLowerCase() === wanted.toLowerCase(),
  );
  const cleanBody = body.trim();
  if (start === -1) {
    if (!cleanBody) return existing;
    return [existing, `${wanted}\n${cleanBody}`].filter(Boolean).join("\n\n");
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const lvl = headingLevel(lines[i]);
    if (lvl && lvl <= level) {
      end = i;
      break;
    }
  }
  const before = lines.slice(0, start).join("\n").trimEnd();
  const after = lines.slice(end).join("\n").trimStart();
  const section = cleanBody ? `${wanted}\n${cleanBody}` : "";
  return [before, section, after].filter(Boolean).join("\n\n");
}

export function formatAppend(name: string, text: string, now: Date): string {
  const clean = text.trim();
  if (name !== "decisions") return clean;
  // Decisions are dated bullets so the next chat can tell old rulings from new.
  const day = now.toISOString().slice(0, 10);
  return clean
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const body = l.replace(/^\s*[-*]\s*/, "");
      return /^\[\d{4}-\d{2}-\d{2}\]/.test(body)
        ? `- ${body}`
        : `- [${day}] ${body}`;
    })
    .join("\n");
}

export type ArchivableFile = "decisions" | "facts";

export function isArchivableFile(name: string): name is ArchivableFile {
  return name === "decisions" || name === "facts";
}

/**
 * When decisions or facts would grow past their limit, the OLDEST lines are
 * set aside (they go to an archive topic) so the file fits again. Headings and
 * blank lines stay. Nothing is thrown away: see appendToArchive.
 */
export function planFit(
  name: ArchivableFile,
  text: string,
): { text: string; removed: string[] } {
  const limit = MEMORY_LIMITS[name];
  const clean = text.trim();
  if (clean.length <= limit) return { text: clean, removed: [] };
  const lines = clean.split("\n");
  const keep = lines.map(() => true);
  const removed: string[] = [];
  const render = () =>
    lines
      .filter((_, i) => keep[i])
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  let current = render();
  for (let i = 0; i < lines.length && current.length > limit; i++) {
    if (!lines[i].trim() || headingLevel(lines[i])) continue;
    keep[i] = false;
    removed.push(lines[i]);
    current = render();
  }
  if (current.length > limit) {
    throw new DyadError(
      `That would make ${name} ${current.length} characters even after moving its older lines out; the limit is ${limit}. Shorten what you are adding. Nothing was saved.`,
      DyadErrorKind.Validation,
    );
  }
  return { text: current, removed };
}

function archiveName(base: string, n: number): string {
  return n === 1 ? base : `${base}-${n}`;
}

/**
 * Appends lines to the archive topic for `name` (decisions-archive,
 * decisions-archive-2, ...), starting a new numbered file when one is full.
 * Returns the topic file the lines ended up in.
 */
export function appendToArchive(
  appId: number,
  name: ArchivableFile,
  lines: string[],
): string {
  const base = `${name}-archive`;
  const addition = lines.join("\n");
  const existing = new Set(listTopicFiles(appId));
  let n = 1;
  while (existing.has(archiveName(base, n + 1))) n++;
  let target = archiveName(base, n);
  let current = readMemoryFile(appId, target);
  if (current && current.length + 1 + addition.length > TOPIC_LIMIT) {
    n++;
    target = archiveName(base, n);
    current = "";
  }
  const header = `# Older ${name} (moved here, oldest first, when ${name} filled up)`;
  writeMemoryFile(
    appId,
    target,
    [current || header, addition].filter(Boolean).join("\n"),
  );
  return target;
}

export interface UpdateMemoryArgs {
  file: string;
  mode: MemoryMode;
  text: string;
  heading?: string;
}

export function updateMemory(
  appId: number,
  args: UpdateMemoryArgs,
  now: Date = new Date(),
): string {
  const name = normalizeMemoryName(args.file);
  const existing = readMemoryFile(appId, name);
  let next: string;
  if (args.mode === "append") {
    if (!args.text.trim()) {
      throw new DyadError("Nothing to append.", DyadErrorKind.Validation);
    }
    next = [existing, formatAppend(name, args.text, now)]
      .filter(Boolean)
      .join("\n");
  } else if (args.mode === "replace_section") {
    if (!args.heading) {
      throw new DyadError(
        "replace_section needs a heading.",
        DyadErrorKind.Validation,
      );
    }
    next = replaceSection(existing, args.heading, args.text);
  } else {
    next = args.text.trim();
  }
  let moved = "";
  if (args.mode === "append" && isArchivableFile(name)) {
    const fit = planFit(name, next);
    if (fit.removed.length) {
      const topic = appendToArchive(appId, name, fit.removed);
      next = fit.text;
      moved = ` Moved the ${fit.removed.length} oldest line(s) to topics/${topic} (read_memory opens it) to make room.`;
    }
  }
  writeMemoryFile(appId, name, next);
  const size = next.trim().length;
  return size
    ? `Saved ${name} (${size} of ${limitFor(name)} characters used).${moved}`
    : `Cleared ${name}.`;
}

function indexLine(name: string, text: string, label?: string): string {
  const what = isCoreMemoryFile(name)
    ? CORE_PURPOSE[name]
    : describeTopic(text);
  const size = text ? `${text.length} chars` : "empty";
  return `- ${label ?? name} (${size}): ${what}`;
}

/** What read_memory returns for a missing or unnamed file. */
export function memoryIndexText(appId: number): string {
  const lines: string[] = CORE_MEMORY_FILES.map((n) =>
    indexLine(n, readMemoryFile(appId, n)),
  );
  for (const t of listTopicFiles(appId)) {
    lines.push(indexLine(t, readMemoryFile(appId, t), `topics/${t}`));
  }
  return lines.join("\n");
}

/** The block added to the app's rules at the start of every turn. */
export function agentMemoryPromptBlock(appId: number): string {
  const sections = CORE_MEMORY_FILES.map((n) => {
    const text = readMemoryFile(appId, n);
    return `### ${n}\n${text || "(empty)"}`;
  });
  return (
    `\n\n## Your memory for this app\n` +
    `This is your own memory of earlier work in this app, kept between chats. Trust it as your starting point and check it when something looks off. Read "decisions" before proposing anything and never re-propose what it rules out. Open any file below with read_memory; change it with update_memory.\n\n` +
    `Files:\n${memoryIndexText(appId)}\n\n` +
    sections.join("\n\n") +
    libraryPromptSection(appId)
  );
}

function libraryPromptSection(appId: number): string {
  const library = readLibrary(appId);
  if (!library) return "";
  return (
    `\n\n### chat library (older chats in this app, newest last)\n` +
    `${library}\n` +
    `The detail of an older chat is NOT in your memory on purpose. When you need something from one, open it: search_chats for a keyword, or read_chat with the chat number above. Do that before asking the user to repeat themselves or re-deriving something.`
  );
}

// ---------------------------------------------------------------------------
// The chat library: one line per past chat, newest last. Handoffs add the line
// for the chat that just ended. It is shown to her at the start of every chat,
// so she knows what each older chat was about and can open one (read_chat)
// instead of carrying its detail forward.
// ---------------------------------------------------------------------------

export const LIBRARY_MAX_LINES = 15;
export const LIBRARY_MAX_CHARS = 3500;
const LIBRARY_LINE_MAX = 420;

function libraryPath(appId: number): string {
  return path.join(agentMemoryDir(appId), "library.md");
}

export function readLibrary(appId: number): string {
  try {
    return fs.readFileSync(libraryPath(appId), "utf8").trim();
  } catch {
    return "";
  }
}

function libraryLineChatId(line: string): number | null {
  const m = /^-\s*chat\s+(\d+)\b/.exec(line.trim());
  return m ? Number(m[1]) : null;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** What the library would hold after adding this chat; nothing is written. */
export function planLibrary(
  appId: number,
  entry: { chatId: number; title?: string | null; summary?: string | null },
  now: Date,
): string {
  const title = oneLine(entry.title ?? "", 90);
  const summary = oneLine(entry.summary ?? "", LIBRARY_LINE_MAX);
  const label =
    [title, summary].filter(Boolean).join(" — ") || "(no description)";
  const line = `- chat ${entry.chatId} (${now.toISOString().slice(0, 10)}): ${oneLine(label, LIBRARY_LINE_MAX)}`;
  const kept = readLibrary(appId)
    .split("\n")
    .filter((l) => l.trim() && libraryLineChatId(l) !== entry.chatId);
  kept.push(line);
  while (
    kept.length > LIBRARY_MAX_LINES ||
    (kept.length > 1 && kept.join("\n").length > LIBRARY_MAX_CHARS)
  ) {
    kept.shift();
  }
  return kept.join("\n");
}

export function writeLibrary(appId: number, text: string): void {
  fs.mkdirSync(agentMemoryDir(appId), { recursive: true });
  const file = libraryPath(appId);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${text.trim()}\n`);
  fs.renameSync(temp, file);
}

export interface HandoffRecord {
  chatId: number;
  savedAt: number;
}

function handoffRecordPath(appId: number): string {
  return path.join(agentMemoryDir(appId), "handoff.json");
}

/** Notes which chat last wrote a handoff, and when (milliseconds). */
export function writeHandoffRecord(appId: number, record: HandoffRecord): void {
  fs.mkdirSync(agentMemoryDir(appId), { recursive: true });
  const file = handoffRecordPath(appId);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(record));
  fs.renameSync(temp, file);
}

export function readHandoffRecord(appId: number): HandoffRecord | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(handoffRecordPath(appId), "utf8"),
    );
    if (
      typeof parsed?.chatId === "number" &&
      typeof parsed?.savedAt === "number"
    ) {
      return { chatId: parsed.chatId, savedAt: parsed.savedAt };
    }
  } catch {
    // No record yet, or an unreadable one: treat as no handoff.
  }
  return null;
}

/** Removes an app's cabinet when the app is deleted. Never throws. */
export function deleteAgentMemory(appId: number): void {
  try {
    fs.rmSync(agentMemoryDir(appId), { recursive: true, force: true });
  } catch {
    // A leftover folder is harmless.
  }
}
