import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ToolDefinition, AgentContext } from "./types";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";
import {
  normalizeSection,
  patchMediaMeta,
  readMediaMeta,
} from "@/ipc/utils/media_gallery_index";
import { safeJoin } from "@/ipc/utils/path_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const MAX_FILES = 300;

const tagMediaSchema = z.object({
  files: z
    .array(z.string())
    .min(1)
    .max(MAX_FILES)
    .describe(
      "Pictures to tag. Each is a file name in .dyad/media (generated-123.png), a path to one (.dyad/media/generated-123.png), or the path of an identical COPY elsewhere in the project (public/library/nyx/x.jpg). A copy is matched to its original in .dyad/media by content.",
    ),
  section: z
    .string()
    .optional()
    .describe(
      "Section to file them under on the Media page, for example 'Nyx' or 'Muse'. Pass an empty string to clear the section. Leave out to keep the current one.",
    ),
  pinned: z
    .boolean()
    .optional()
    .describe(
      "true keeps them out of the 30-day archive (use for keepers); false lets them age out again. Leave out to keep the current setting.",
    ),
});

const DESCRIPTION = `Set the Media-page section and/or pin state of pictures that are already in this project's .dyad/media. Writes through Crackerbox's own locked index, so it is safe while renders are being saved, and the Media page shows the change the next time it loads (no restart).

### When to Use
- Sorting renders into sections (for example Nyx or Muse)
- Pinning keepers so the 30-day archive never takes them
- Tagging the originals of pictures you copied into public/library

Prefer this over editing .dyad/gallery-index.json by hand.`;

async function sha256(file: string): Promise<string> {
  return crypto
    .createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}

export const tagMediaTool: ToolDefinition<z.infer<typeof tagMediaSchema>> = {
  name: "tag_media",
  description: DESCRIPTION,
  inputSchema: tagMediaSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) =>
    `Tag ${args.files.length} picture(s)` +
    (args.section !== undefined ? ` as "${args.section}"` : "") +
    (args.pinned !== undefined
      ? args.pinned
        ? ", pinned"
        : ", unpinned"
      : ""),

  execute: async (args, ctx: AgentContext) => {
    if (args.section === undefined && args.pinned === undefined) {
      throw new DyadError(
        "Pass a section, pinned, or both.",
        DyadErrorKind.Validation,
      );
    }
    const mediaDir = safeJoin(ctx.appPath, DYAD_MEDIA_DIR_NAME);
    let onDisk: string[] = [];
    try {
      onDisk = await fs.readdir(mediaDir);
    } catch {
      // no media folder yet: everything below reports as not found
    }
    const known = new Set(onDisk);
    let hashes: Map<string, string> | undefined;
    const findByContent = async (abs: string): Promise<string | undefined> => {
      if (!hashes) {
        hashes = new Map();
        for (const name of onDisk) {
          if (name.endsWith(".json")) continue;
          try {
            hashes.set(await sha256(path.join(mediaDir, name)), name);
          } catch {
            // unreadable file: skip
          }
        }
      }
      return hashes.get(await sha256(abs));
    };

    const section =
      args.section === undefined
        ? undefined
        : (normalizeSection(args.section) ?? null);
    const before = await readMediaMeta(ctx.appPath);
    let changed = 0;
    const missing: string[] = [];
    const done = new Set<string>();
    for (const raw of args.files) {
      let name = path.basename(raw.replace(/\\/g, "/"));
      if (!known.has(name)) {
        let match: string | undefined;
        try {
          match = await findByContent(safeJoin(ctx.appPath, raw));
        } catch {
          match = undefined;
        }
        if (!match) {
          missing.push(raw);
          continue;
        }
        name = match;
      }
      if (done.has(name)) continue;
      done.add(name);
      await patchMediaMeta(ctx.appPath, name, {
        ...(section !== undefined ? { section } : {}),
        ...(args.pinned !== undefined ? { pinned: args.pinned } : {}),
      });
      const was = before[name];
      if (
        (section !== undefined && (was?.section ?? null) !== section) ||
        (args.pinned !== undefined && Boolean(was?.pinned) !== args.pinned)
      ) {
        changed++;
      }
    }
    const lines = [
      `Tagged ${done.size} picture(s) (${changed} changed)` +
        (section ? ` in section "${section}"` : "") +
        (args.pinned === true ? ", pinned" : "") +
        (args.pinned === false ? ", unpinned" : "") +
        ".",
    ];
    if (missing.length) {
      lines.push(
        `Not found in .dyad/media, and no identical copy there: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ` and ${missing.length - 10} more` : ""}`,
      );
    }
    return lines.join("\n");
  },
};
