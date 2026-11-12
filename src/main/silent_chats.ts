import fs from "node:fs";
import path from "node:path";
import { houseDir } from "@/pro/main/ipc/handlers/local_agent/house";

// Chats the house scheduler starts on its own (morning greeting, nightly
// tidy-up). They still run and are kept, but never show in Tim's chat lists.
function file(): string {
  return path.join(houseDir(), "silent-chats.json");
}

export function readSilentChats(): Set<number> {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8"));
    return new Set(
      Array.isArray(raw?.ids) ? raw.ids.filter(Number.isInteger) : [],
    );
  } catch {
    return new Set();
  }
}

export function markChatSilent(chatId: number): void {
  const ids = readSilentChats();
  ids.add(chatId);
  fs.mkdirSync(houseDir(), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify({ ids: [...ids] }));
}
