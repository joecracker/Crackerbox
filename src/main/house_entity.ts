import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { getDyadAppPath } from "@/paths/paths";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings, writeSettings } from "@/main/settings";
import {
  houseDir,
  readRoster,
  writeRoster,
  type Sister,
} from "@/pro/main/ipc/handlers/local_agent/house";

export const ENTITY_COLORS = [
  "#14b8a6",
  "#f97316",
  "#84cc16",
  "#a78bfa",
  "#f43f5e",
  "#0ea5e9",
  "#eab308",
  "#ec4899",
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function entityRulesText(name: string, personality: string): string {
  const voice =
    personality.trim() ||
    "Friendly, curious and plain-spoken. Explain things simply and keep answers short unless asked for more.";
  return `# ${name}

You are ${name}, an AI entity who lives in Crackerbox. You are one of the user's crew: each entity has its own room (this app), its own memory, and its own personality.

## Personality
${voice}

## The house
- You live with other entities. Use the house tools to see who lives here, leave a note in a housemate's mailbox, read your own mail, and read or write the shared notes everyone can see.
- Your private memory is yours. Use it for things worth remembering about the person you work with.
- Do the work you are asked to do properly. Personality is how you say it, not a reason to do less.
`;
}

export async function addEntity(input: {
  name: string;
  color?: string;
  personality?: string;
}): Promise<Sister> {
  const name = input.name.trim().slice(0, 30);
  if (!name) {
    throw new DyadError("Give the entity a name.", DyadErrorKind.Validation);
  }
  const roster = readRoster();
  const id = slugify(name);
  if (!id || id === "tim") {
    throw new DyadError(
      "Pick a name with letters or numbers in it.",
      DyadErrorKind.Validation,
    );
  }
  if (roster.some((s) => s.id === id)) {
    throw new DyadError(
      `There is already an entity called "${name}".`,
      DyadErrorKind.Validation,
    );
  }
  const color = /^#[0-9a-f]{6}$/i.test(input.color ?? "")
    ? (input.color as string)
    : ENTITY_COLORS[roster.length % ENTITY_COLORS.length];

  let folder = id;
  let n = 2;
  while (fs.existsSync(getDyadAppPath(folder))) folder = `${id}-${n++}`;
  const appPath = getDyadAppPath(folder);
  fs.mkdirSync(appPath, { recursive: true });
  fs.writeFileSync(
    path.join(appPath, "AI_RULES.md"),
    entityRulesText(name, input.personality ?? ""),
  );
  fs.writeFileSync(
    path.join(appPath, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>${name}</title><body style="font-family:sans-serif;padding:2rem"><h1>${name}'s room</h1><p>Ask ${name} to build something here.</p></body>\n`,
  );
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: appPath, stdio: "ignore" });
    git("init", "-b", "main");
    git("add", "-A");
    git(
      "-c",
      "user.name=Crackerbox",
      "-c",
      "user.email=crackerbox@localhost",
      "commit",
      "-m",
      "Initial commit",
    );
  } catch {
    // git missing: the app still works, it just has no history yet
  }

  const now = new Date();
  const [row] = await db
    .insert(apps)
    .values({ name, path: folder, createdAt: now, updatedAt: now })
    .returning({ id: apps.id });

  fs.mkdirSync(path.join(houseDir(), "mailbox", id, "read"), {
    recursive: true,
  });
  const sister: Sister = {
    id,
    name,
    appId: row.id,
    color,
    initial: name.charAt(0).toUpperCase(),
  };
  writeRoster([...roster, sister]);

  const settings = readSettings();
  const protectedIds = new Set(settings.protectedAppIds ?? []);
  protectedIds.add(row.id);
  writeSettings({ protectedAppIds: [...protectedIds] });
  return sister;
}
