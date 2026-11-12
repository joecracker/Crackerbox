import fs from "node:fs";
import path from "node:path";
import { houseDir } from "@/pro/main/ipc/handlers/local_agent/house";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

/**
 * Turns a roster face picture (a path inside the house folder) into a data
 * URL the window can show. Returns undefined if there is none, it escapes the
 * house folder, or it is too big for a little badge.
 */
export function readAvatarDataUrl(avatar?: string): string | undefined {
  if (!avatar) return undefined;
  try {
    const root = path.resolve(houseDir());
    const full = path.resolve(root, avatar);
    if (!full.startsWith(root + path.sep)) return undefined;
    const mime = MIME[path.extname(full).toLowerCase()];
    if (!mime) return undefined;
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > 512 * 1024) return undefined;
    return `data:${mime};base64,${fs.readFileSync(full).toString("base64")}`;
  } catch {
    return undefined;
  }
}
