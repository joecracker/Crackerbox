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
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import { findVeniceApiKey } from "./venice_api";
import { IMAGE_ASPECTS, generateVeniceImage } from "./venice_image";

const logger = log.scope("generate_image");

const generateImageSchema = z.object({
  prompt: z
    .string()
    .describe(
      "A detailed, descriptive prompt for the image to generate. Be specific about colors, composition, style, mood, and subject matter. Avoid generic or vague descriptions.",
    ),
  aspect_ratio: z
    .enum(IMAGE_ASPECTS)
    .optional()
    .describe(
      "Shape of the picture, for example 16:9 for a wide banner or 1:1 for an icon. Default 1:1.",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "A Venice image model id. Leave this out to use the default; only set it when the user asked for a specific model.",
    ),
});

const DESCRIPTION = `Generate an image from a text prompt with the user's own Venice account. The generated image is saved to the project's .dyad/media directory.

### When to Use
- User requests a custom image, illustration, icon, or graphic for their app
- User wants a hero image, background, banner, or visual asset
- Creating images that are more visually relevant than placeholder rectangles

### Prompt Guidelines
Write detailed, descriptive prompts. Be specific about:
- **Subject**: What is in the image (objects, people, scenes)
- **Style**: Photography, illustration, flat design, 3D render, watercolor, etc.
- **Composition**: Layout, perspective, framing
- **Colors**: Specific color palette or mood
- **Mood**: Cheerful, professional, dramatic, minimal, etc.

### Examples
- "A modern flat illustration of a team collaborating around a laptop, using a blue and purple color palette, clean minimal style with subtle gradients, white background"
- "Professional product photography of a sleek smartphone on a marble surface, soft studio lighting, shallow depth of field, warm neutral tones"

### After Generation
The tool returns the file path in .dyad/media. Use the copy_file tool to copy it to the appropriate location in the project (e.g., public/assets/) and reference that path in your code. Each picture costs a little Venice credit, so generate only what is needed.
`;

function veniceKey(): string | undefined {
  return findVeniceApiKey(readSettings().providerSettings);
}

async function saveGeneratedImage(
  bytes: Buffer,
  appPath: string,
): Promise<string> {
  const mediaDir = path.join(appPath, DYAD_MEDIA_DIR_NAME);
  await fs.mkdir(mediaDir, { recursive: true });

  const hash = crypto.randomBytes(8).toString("hex");
  const fileName = `generated-${Date.now()}-${hash}.png`;
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

  // Only offered when a Venice key is set up.
  isEnabled: () => Boolean(veniceKey()),

  getConsentPreview: (args) => `Generate image: "${args.prompt}"`,

  shouldTrackMutation: (_args, result) =>
    result.startsWith("Image generated and saved"),

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

    try {
      const apiKey = veniceKey();
      if (!apiKey) {
        throw new DyadError(
          "Image generation needs a Venice API key. Add Venice as a provider in Settings.",
          DyadErrorKind.Precondition,
        );
      }
      const { bytes, model } = await generateVeniceImage({
        apiKey,
        prompt: args.prompt,
        aspect: args.aspect_ratio,
        model: args.model,
        signal: ctx.abortSignal,
      });

      const relativePath = await saveGeneratedImage(bytes, ctx.appPath);

      ctx.onXmlComplete(
        `<dyad-image-generation prompt="${escapeXmlAttr(args.prompt)}" path="${escapeXmlAttr(relativePath)}">${escapeXmlContent(relativePath)}</dyad-image-generation>`,
      );

      logger.log(`Image generation (${model}) saved to: ${relativePath}`);

      return `Image generated and saved to: ${relativePath}\nUse the copy_file tool to copy it from "${relativePath}" to the appropriate location in the project (e.g., public/assets/), then reference the copied path in your code.`;
    } catch (error) {
      ctx.onXmlComplete(
        `<dyad-image-generation prompt="${escapeXmlAttr(args.prompt)}"></dyad-image-generation>`,
      );
      throw error;
    }
  },
};
