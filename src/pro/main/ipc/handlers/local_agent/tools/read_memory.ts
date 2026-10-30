import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";
import {
  isCoreMemoryFile,
  listTopicFiles,
  memoryIndexText,
  normalizeMemoryName,
  readMemoryFile,
} from "../agent_memory";

const readMemorySchema = z.object({
  file: z
    .string()
    .describe(
      "state, decisions, facts, or a topic name from your memory index.",
    ),
});

export const readMemoryTool: ToolDefinition<z.infer<typeof readMemorySchema>> =
  {
    name: "read_memory",
    description: `Open one file from your memory for this app (state, decisions, facts, or a topic file listed in your memory index) and get its current full text. Use it for topic files, and to re-check a core file after changing it.`,
    inputSchema: readMemorySchema,
    defaultConsent: "always",
    modifiesState: false,
    mutationTracking: "none",
    requiresBlueprintApproval: false,

    getConsentPreview: (args) => `Read my memory (${args.file})`,

    execute: async (args, ctx: AgentContext) => {
      const name = normalizeMemoryName(args.file);
      const text = readMemoryFile(ctx.appId, name);
      if (text) return text;
      if (isCoreMemoryFile(name) || listTopicFiles(ctx.appId).includes(name)) {
        return `${name} is empty.`;
      }
      return `There is no memory file called "${name}". What exists:\n${memoryIndexText(ctx.appId)}`;
    },
  };
