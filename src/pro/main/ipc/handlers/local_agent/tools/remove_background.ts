import { z } from "zod";
import log from "electron-log";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";
import { patchMediaMeta, readMediaMeta } from "@/ipc/utils/media_gallery_index";
import { safeJoin } from "@/ipc/utils/path_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import { findVeniceApiKey } from "./venice_api";
import {
  BG_REMOVE_MAX_BYTES,
  removeBackgroundWithVenice,
} from "./background_removal";

const logger = log.scope("remove_background");

const SOURCE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

const removeBackgroundSchema = z.object({
  image_path: z
    .string()
    .describe(
      "Path of the picture inside the project, for example .dyad/media/generated-123.png or public/assets/hero.jpg.",
    ),
  section: z
    .string()
    .optional()
    .describe(
      "Media-page section to file the cutout under. Defaults to the source picture's section, or 'cutouts'.",
    ),
});

const DESCRIPTION = `Cut the background out of a picture, leaving the subject on a transparent background. Uses the user's own Venice account (same key as image making). The cutout is saved as a new PNG in the project's .dyad/media directory next to the original; the original is left alone.

### When to Use
- The user wants a clean cutout of a person, product, logo, icon or character
- You need a transparent-background asset for the app

### After It Runs
The result gives the new file's path. To use it in the app, copy it with copy_file (e.g., to public/assets/). Each cutout costs a little Venice credit.`;

export const removeBackgroundTool: ToolDefinition<
  z.infer<typeof removeBackgroundSchema>
> = {
  name: "remove_background",
  description: DESCRIPTION,
  inputSchema: removeBackgroundSchema,
  defaultConsent: "always",
  modifiesState: true,

  isEnabled: () => Boolean(findVeniceApiKey(readSettings().providerSettings)),

  getConsentPreview: (args) => `Remove background: ${args.image_path}`,

  shouldTrackMutation: (_args, result) =>
    result.startsWith("Background removed and saved"),

  buildXml: (args, isComplete) => {
    if (!args.image_path) return undefined;
    if (isComplete) return undefined;
    return `<dyad-image-generation prompt="${escapeXmlAttr(`Cut out background: ${args.image_path}`)}">`;
  },

  execute: async (args, ctx: AgentContext) => {
    const label = `Cut out background: ${args.image_path}`;
    const emptyCard = `<dyad-image-generation prompt="${escapeXmlAttr(label)}"></dyad-image-generation>`;
    ctx.onXmlStream(`<dyad-image-generation prompt="${escapeXmlAttr(label)}">`);

    try {
      const apiKey = findVeniceApiKey(readSettings().providerSettings);
      if (!apiKey) {
        throw new DyadError(
          "Cutting out a background needs a Venice API key. Add Venice as a provider in Settings.",
          DyadErrorKind.Precondition,
        );
      }

      const rel = args.image_path.replace(/\\/g, "/").replace(/^\.\//, "");
      const sourceAbs = safeJoin(ctx.appPath, rel);
      if (!SOURCE_EXTENSIONS.includes(path.extname(sourceAbs).toLowerCase())) {
        throw new DyadError(
          `Only ${SOURCE_EXTENSIONS.join(", ")} pictures can be cut out.`,
          DyadErrorKind.Validation,
        );
      }
      let size: number;
      try {
        const stat = await fs.stat(sourceAbs);
        if (!stat.isFile()) throw new Error("not a file");
        size = stat.size;
      } catch {
        throw new DyadError(
          `No picture found at "${rel}".`,
          DyadErrorKind.NotFound,
        );
      }
      if (size > BG_REMOVE_MAX_BYTES) {
        throw new DyadError(
          "That picture is over 25 MB, which is more than Venice accepts for cutouts.",
          DyadErrorKind.Validation,
        );
      }

      const png = await removeBackgroundWithVenice({
        apiKey,
        bytes: await fs.readFile(sourceAbs),
        signal: ctx.abortSignal,
      });

      const mediaDir = path.join(ctx.appPath, DYAD_MEDIA_DIR_NAME);
      await fs.mkdir(mediaDir, { recursive: true });
      const base = path.parse(sourceAbs).name;
      let fileName = `${base}-cutout.png`;
      try {
        await fs.access(path.join(mediaDir, fileName));
        fileName = `${base}-cutout-${Date.now()}.png`;
      } catch {
        // Name is free.
      }
      await fs.writeFile(path.join(mediaDir, fileName), png);

      const sourceName = path.basename(sourceAbs);
      let inheritedSection: string | undefined;
      if (path.resolve(path.dirname(sourceAbs)) === path.resolve(mediaDir)) {
        inheritedSection = (await readMediaMeta(ctx.appPath))[sourceName]
          ?.section;
      }
      try {
        await patchMediaMeta(ctx.appPath, fileName, {
          section: args.section ?? inheritedSection ?? "cutouts",
          prompt: `Cutout of ${sourceName}`,
          engine: "venice-background-remove",
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        logger.warn("Could not save picture details:", error);
      }

      const relativePath = path.join(DYAD_MEDIA_DIR_NAME, fileName);
      ctx.onXmlComplete(
        `<dyad-image-generation prompt="${escapeXmlAttr(label)}" path="${escapeXmlAttr(relativePath)}">${escapeXmlContent(relativePath)}</dyad-image-generation>`,
      );
      logger.log(`Cutout of ${rel} saved to: ${relativePath}`);

      return [
        `Background removed and saved to: ${relativePath}`,
        "Made by venice-background-remove. The original picture was not changed.",
        `To use it in the app, copy it with copy_file (e.g., to public/assets/).`,
      ].join("\n");
    } catch (error) {
      ctx.onXmlComplete(emptyCard);
      throw error;
    }
  },
};
