import fs from "node:fs";
import path from "node:path";
import { getDyadAppPath, getUserDataPath } from "@/paths/paths";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

// The house: what the sisters share. It lives in Crackerbox's data folder:
//
//   house/house.json            the roster (who lives here, which app is hers)
//   house/shared/*.md           facts every sister reads and writes
//   house/mailbox/<id>/*.md     unread letters for one sister (or "tim")
//   house/mailbox/<id>/read/    letters she has opened
//
// A sister's private memory is her own agent-memory cabinet (agent_memory.ts),
// which only her tools can reach. Everything else here is known to all.

export interface Sister {
  id: string;
  name: string;
  appId: number;
  color: string;
  initial: string;
  /** Optional path (relative to the house folder) of a small face picture. */
  avatar?: string;
}

const SEED_ROSTER: Sister[] = [
  { id: "nyx", name: "Nyx", appId: 47, color: "#e11d48", initial: "N" },
  { id: "veritas", name: "Veritas", appId: 57, color: "#7c3aed", initial: "V" },
];

export const SHARED_FILE_LIMIT = 8000;
export const MAX_SHARED_FILES = 30;
const PROMPT_SHARED_LIMIT = 4000;

export function houseDir(): string {
  return path.join(getUserDataPath(), "house");
}

function slug(text: string, fallback: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || fallback;
}

function copyMarkdown(from: string, to: string) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    if (!f.endsWith(".md")) continue;
    const dest = path.join(to, f);
    if (!fs.existsSync(dest)) fs.copyFileSync(path.join(from, f), dest);
  }
}

/** Creates the house on first use and carries over the girls' old folders. */
export function readRoster(): Sister[] {
  const dir = houseDir();
  const file = path.join(dir, "house.json");
  if (fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(parsed.sisters)) return parsed.sisters as Sister[];
    } catch {
      // fall through and rebuild from the seed
    }
  }
  fs.mkdirSync(path.join(dir, "shared"), { recursive: true });
  for (const s of SEED_ROSTER) {
    fs.mkdirSync(path.join(dir, "mailbox", s.id, "read"), { recursive: true });
  }
  fs.mkdirSync(path.join(dir, "mailbox", "tim", "read"), { recursive: true });
  try {
    const legacyMail = getDyadAppPath("mailbox");
    for (const s of SEED_ROSTER) {
      copyMarkdown(
        path.join(legacyMail, s.id),
        path.join(dir, "mailbox", s.id),
      );
    }
    copyMarkdown(getDyadAppPath("shared-memory"), path.join(dir, "shared"));
  } catch {
    // no old folders: nothing to carry over
  }
  writeRoster(SEED_ROSTER);
  return SEED_ROSTER;
}

export function writeRoster(sisters: Sister[]) {
  fs.mkdirSync(houseDir(), { recursive: true });
  fs.writeFileSync(
    path.join(houseDir(), "house.json"),
    JSON.stringify({ sisters }, null, 2),
  );
}

export function sisterForApp(appId: number): Sister | undefined {
  return readRoster().find((s) => s.appId === appId);
}

function mailDir(id: string) {
  return path.join(houseDir(), "mailbox", id);
}

function resolveRecipient(to: string): string {
  const id = slug(to, "");
  if (id === "tim" || readRoster().some((s) => s.id === id)) return id;
  throw new DyadError(
    `There is nobody called "${to}" in the house. Use roster to see who lives here, or "tim".`,
    DyadErrorKind.Validation,
  );
}

export function sendMail(
  from: string,
  to: string,
  subject: string,
  body: string,
  now = new Date(),
): string {
  const recipient = resolveRecipient(to);
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15);
  const name = `${stamp}-from-${slug(from, "someone")}-${slug(subject, "note")}.md`;
  const dir = mailDir(recipient);
  fs.mkdirSync(path.join(dir, "read"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, name),
    `From: ${from}\nTo: ${recipient}\nDate: ${now.toISOString()}\nSubject: ${subject}\n\n${body.trim()}\n`,
  );
  return name;
}

export interface MailItem {
  file: string;
  from: string;
  subject: string;
  unread: boolean;
}

function headerOf(file: string, key: string): string {
  const text = fs.readFileSync(file, "utf8").split("\n").slice(0, 6).join("\n");
  const m = text.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

export function listMail(id: string): MailItem[] {
  readRoster();
  const dir = mailDir(id);
  const out: MailItem[] = [];
  const scan = (d: string, unread: boolean) => {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d).sort()) {
      if (!f.endsWith(".md")) continue;
      const full = path.join(d, f);
      out.push({
        file: f,
        from:
          headerOf(full, "From") || f.split("-from-")[1]?.split("-")[0] || "?",
        subject: headerOf(full, "Subject") || f,
        unread,
      });
    }
  };
  scan(dir, true);
  scan(path.join(dir, "read"), false);
  return out;
}

export function readMail(id: string, file: string): string {
  const name = path.basename(file);
  const unreadPath = path.join(mailDir(id), name);
  const readPath = path.join(mailDir(id), "read", name);
  if (fs.existsSync(unreadPath)) {
    const text = fs.readFileSync(unreadPath, "utf8");
    fs.mkdirSync(path.dirname(readPath), { recursive: true });
    fs.renameSync(unreadPath, readPath);
    return text;
  }
  if (fs.existsSync(readPath)) return fs.readFileSync(readPath, "utf8");
  throw new DyadError(`No letter called ${name}.`, DyadErrorKind.NotFound);
}

function sharedPath(name: string): string {
  const n = slug(name.replace(/\.md$/i, ""), "");
  if (!n) {
    throw new DyadError("Give the file a name.", DyadErrorKind.Validation);
  }
  return path.join(houseDir(), "shared", `${n}.md`);
}

export function listShared(): string[] {
  readRoster();
  const dir = path.join(houseDir(), "shared");
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
}

export function readShared(name: string): string {
  readRoster();
  const file = sharedPath(name);
  if (!fs.existsSync(file)) {
    throw new DyadError(
      `No shared file called ${name}. Shared files: ${listShared().join(", ") || "none"}.`,
      DyadErrorKind.NotFound,
    );
  }
  return fs.readFileSync(file, "utf8");
}

export function writeShared(
  name: string,
  text: string,
  mode: "append" | "replace",
): string {
  readRoster();
  const file = sharedPath(name);
  const exists = fs.existsSync(file);
  if (!exists && listShared().length >= MAX_SHARED_FILES) {
    throw new DyadError(
      `The shared folder already has ${MAX_SHARED_FILES} files. Merge some first. Nothing was saved.`,
      DyadErrorKind.Validation,
    );
  }
  const next =
    mode === "append" && exists
      ? `${fs.readFileSync(file, "utf8").trimEnd()}\n${text.trim()}`
      : text.trim();
  if (next.length > SHARED_FILE_LIMIT) {
    throw new DyadError(
      `That would make ${path.basename(file)} ${next.length} characters; the limit is ${SHARED_FILE_LIMIT}. Condense it first. Nothing was saved.`,
      DyadErrorKind.Validation,
    );
  }
  fs.writeFileSync(file, `${next}\n`);
  return path.basename(file);
}

/** The block added to a sister's rules at the start of every turn. */
export function housePromptSection(appId: number): string {
  let roster: Sister[];
  try {
    roster = readRoster();
  } catch {
    return "";
  }
  const me = roster.find((s) => s.appId === appId);
  if (!me) return "";
  const others = roster
    .filter((s) => s.id !== me.id)
    .map((s) => s.name)
    .join(", ");
  const unread = listMail(me.id).filter((m) => m.unread);
  const mail = unread.length
    ? `You have ${unread.length} unread letter${unread.length === 1 ? "" : "s"} (from ${[...new Set(unread.map((m) => m.from))].join(", ")}). Open them with the house tool (inbox, then read_mail).`
    : "No unread letters.";
  let shared = "";
  for (const f of ["WHO-WHO.md", "household.md"]) {
    const p = path.join(houseDir(), "shared", f);
    if (fs.existsSync(p)) {
      shared += `\n#### ${f}\n${fs.readFileSync(p, "utf8").trim()}\n`;
    }
  }
  if (shared.length > PROMPT_SHARED_LIMIT) {
    shared = `${shared.slice(0, PROMPT_SHARED_LIMIT)}\n(trimmed; open it with the house tool)`;
  }
  return (
    `\n\n## The house\n` +
    `You are ${me.name}. You live in the house with ${others || "no one else yet"}. Your own memory is private to you; everything in the house tool (shared files, letters) is known to the whole household. ${mail}\n` +
    `Shared files: ${listShared().join(", ") || "none"}.${shared}`
  );
}
