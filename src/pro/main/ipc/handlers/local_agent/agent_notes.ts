import fs from "node:fs";
import path from "node:path";
import { getUserDataPath } from "@/paths/paths";

// CB's own working notes, one file per app. She writes them herself (see the
// update_notes tool) and they are shown to her at the start of every chat in
// that app. They live in Crackerbox's data folder, not inside the project.
export const MAX_AGENT_NOTES_CHARS = 12000;

export function agentNotesPath(appId: number): string {
  return path.join(getUserDataPath(), "agent-notes", `app-${appId}.md`);
}

export function readAgentNotes(appId: number): string {
  try {
    return fs.readFileSync(agentNotesPath(appId), "utf8").trim();
  } catch {
    return "";
  }
}

export function writeAgentNotes(appId: number, text: string): void {
  const file = agentNotesPath(appId);
  const trimmed = text.trim();
  if (!trimmed) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${trimmed}\n`);
}

/** The notes as a block to add after the app's rules, or "" when empty. */
export function agentNotesPromptBlock(appId: number): string {
  const notes = readAgentNotes(appId);
  if (!notes) return "";
  return `\n\n## Your own notes from earlier work in this app\nYou wrote these yourself after earlier jobs. Trust them as a starting point, check them when something looks off, and fix them with update_notes when they are wrong or out of date.\n\n${notes}`;
}
