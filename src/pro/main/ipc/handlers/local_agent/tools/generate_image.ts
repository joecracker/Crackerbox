import { z } from "zod";
import log from "electron-log";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { DYAD_MEDIA_DIR_NAME } from "@/ipc/utils/media_path_utils";
import { patchMediaMeta } from "@/ipc/utils/media_gallery_index";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import { findSirayApiKey, findVeniceApiKey } from "./venice_api";
import {
  ENGINE_NAMES,
  IMAGE_ASPECT_LIST,
  IMAGE_STYLES,
  MAX_COUNT,
  generateImages,
} from "./image_engines";

const logger = log.scope("generate_image");

const generateImageSchema = z.object({
  prompt: z
    .string()
    .describe(
      "A detailed, descriptive prompt for the image to generate. Be specific about subject, look, clothing, setting, lighting, mood and art style. Avoid vague descriptions.",
    ),
  count: z
    .number()
    .int()
    .min(1)
    .max(MAX_COUNT)
    .optional()
    .describe(
      "How many pictures to make, 1 to 4. Use exactly the number the user asked for. Default 1.",
    ),
  aspect_ratio: z
    .enum(IMAGE_ASPECT_LIST)
    .optional()
    .describe(
      "Shape of the picture, for example 16:9 for a wide banner or 1:1 for an icon. Default 1:1.",
    ),
  style: z
    .enum(IMAGE_STYLES)
    .optional()
    .describe(
      "realistic (photo look, default) or anime. Use anime only when the user wants an anime or cartoon look.",
    ),
  section: z
    .string()
    .optional()
    .describe(
      "Media-page section to file the pictures under, for example 'characters', 'backgrounds' or 'logos'. Reuse an existing section name when one fits. Default 'generated'.",
    ),
  negative_prompt: z
    .string()
    .optional()
    .describe(
      "Things to keep OUT of the picture, for example 'text, watermark, extra fingers'. Works on Venice engines. Prefer this over writing 'no X' in the main prompt.",
    ),
  model: z
    .string()
    .optional()
    .describe(
      `Optional engine. Leave out to use the default. One of: ${ENGINE_NAMES.join(", ")}; or any Venice image model id. You do not need to retry yourself: if an engine fails or refuses, the next one is tried automatically and the result says which engine made each picture.`,
    ),
});

const DESCRIPTION = `Generate 1 to 4 pictures from a text prompt using the user's own Venice and Siray accounts. Venice is tried first; if it refuses, times out or fails, Siray engines are tried automatically. Pictures are saved to the project's .dyad/media directory and filed under a section (default "generated") on the Media page, with the prompt and engine remembered.

### When to Use
- The user asks for a picture, illustration, character, icon, hero image or any visual asset

### Prompt Guidelines
Write detailed prompts: subject, style, composition, colors, lighting, mood. Put things to avoid in negative_prompt.

### After Generation
The result lists each saved file and which engine actually made it. Tell the user which engine made the pictures. To use a picture in the app, copy it with copy_file (e.g., to public/assets/). Each picture costs a little credit, so make only what was asked for; there is an hourly safety limit.`;

function keys() {
  const providers = readSettings().providerSettings;
  return {
    venice: findVeniceApiKey(providers),
    siray: findSirayApiKey(providers),
  };
}

async function saveGeneratedImage(
  bytes: Buffer,
  ext: string,
  appPath: string,
): Promise<string> {
  const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
  await fs.mkdir(mediaDir, { recursive: true });

  const hash = crypto.randomBytes(8).toString("hex");
  const fileName = `generated-${Date.now()}-${hash}${ext}`;
  await fs.writeFile(path.join(mediaDir, fileName), bytes);
  return path.join(DYAD_MEDIA_DIR_NAME, fileName);
}

export const generateImageTool: ToolDefinition<
  z.infer<typeof generateImageSchema>
> = {
  name: "generate_image",
  description: DESCRIPTION,
  inputSchema: generateImageSchema,
  defaultConsent: "always",
  modifiesState: true,

  // Offered when at least one image service has a key.
  isEnabled: () => {
    const k = keys();
    return Boolean(k.venice || k.siray);
  },

  getConsentPreview: (args) =>
    `Generate ${args.count ?? 1} image(s): "${args.prompt}"`,

  shouldTrackMutation: (_args, result) =>
    /^Images? generated and saved/.test(result),

  buildXml: (args, isComplete) => {
    if (!args.prompt) return undefined;
    if (isComplete) return undefined;
    return `<dyad-image-generation prompt="${escapeXmlAttr(args.prompt)}">`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing image generation with prompt: ${args.prompt}`);

    ctx.onXmlStream(
      `<dyad-image-generation prompt="${escapeXmlAttr(args.prompt)}">`,
    );

    const emptyCard = `<dyad-image-generation prompt="${escapeXmlAttr(args.prompt)}"></dyad-image-generation>`;

    try {
      const k = keys();
      if (!k.venice && !k.siray) {
        throw new DyadError(
          "Image generation needs a Venice or Siray key. Add one as a provider in Settings.",
          DyadErrorKind.Precondition,
        );
      }

      const batch = await generateImages({
        prompt: args.prompt,
        count: args.count,
        aspect: args.aspect_ratio,
        style: args.style,
        model: args.model,
        negativePrompt: args.negative_prompt,
        keys: k,
        signal: ctx.abortSignal,
      });

      if (batch.images.length === 0) {
        ctx.onXmlComplete(emptyCard);
        throw new DyadError(
          `No pictures were made. ${batch.failures[0] ?? ""}`.trim(),
          DyadErrorKind.External,
        );
      }

      const lines: string[] = [];
      for (const image of batch.images) {
        const relativePath = await saveGeneratedImage(
          image.bytes,
          image.ext,
          ctx.appPath,
        );
        try {
          await patchMediaMeta(ctx.appPath, path.basename(relativePath), {
            section: args.section ?? "generated",
            prompt: args.prompt,
            engine: image.engine,
            createdAt: new Date().toISOString(),
          });
        } catch (error) {
          logger.warn("Could not save picture details:", error);
        }
        ctx.onXmlComplete(
          `<dyad-image-generation prompt="${escapeXmlAttr(args.prompt)}" path="${escapeXmlAttr(relativePath)}">${escapeXmlContent(relativePath)}</dyad-image-generation>`,
        );
        const fell = image.fellBack ? " (backup engine)" : "";
        lines.push(`- ${relativePath} — made by ${image.engine}${fell}`);
        for (const note of image.notes) lines.push(`  note: ${note}`);
        logger.log(`Image (${image.engine}) saved to: ${relativePath}`);
      }

      const made = batch.images.length;
      const wanted = args.count ?? 1;
      const head =
        made === 1
          ? "Image generated and saved:"
          : `Images generated and saved (${made} of ${wanted}):`;
      const tail: string[] = [];
      if (batch.capped) {
        tail.push(
          "The hourly image limit was reached, so no more can be made for a while. Tell the user.",
        );
      }
      if (batch.failures.length) {
        tail.push(
          `${batch.failures.length} could not be made: ${batch.failures[0]}`,
        );
      }
      return [
        head,
        ...lines,
        ...tail,
        "Tell the user which engine made each picture. To use one in the app, copy it with copy_file (e.g., to public/assets/).",
      ].join("\n");
    } catch (error) {
      if (ctx.abortSignal?.aborted) ctx.onXmlComplete(emptyCard);
      throw error;
    }
  },
};
