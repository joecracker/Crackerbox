import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";
import {
  MAX_TOPICS,
  MEMORY_LIMITS,
  TOPIC_LIMIT,
  updateMemory,
} from "../agent_memory";

const updateMemorySchema = z.object({
  file: z
    .string()
    .describe(
      "Which file: state, decisions, facts, or a topic name (lowercase letters, digits, dashes).",
    ),
  mode: z
    .enum(["append", "replace_section", "replace_file"])
    .describe(
      "append adds lines at the end. replace_section rewrites only the part under one heading (give heading). replace_file rewrites the whole file.",
    ),
  heading: z
    .string()
    .optional()
    .describe(
      'For replace_section: the heading line to replace the body under, for example "## Red batch". Added if it is not there yet. Empty text removes the section.',
    ),
  text: z.string().describe("The text to write."),
});

export const updateMemoryTool: ToolDefinition<
  z.infer<typeof updateMemorySchema>
> = {
  name: "update_memory",
  description: `Keep your memory for this app. It is shown to you at the start of every future chat in this app, so write it for a fresh you.

Files:
- state (max ${MEMORY_LIMITS.state} chars): what is being worked on right now and the single next step. Keep it current.
- decisions (max ${MEMORY_LIMITS.decisions}): settled decisions and dead ends, one line each saying what is out and why. Use append; lines are dated for you.
- facts (max ${MEMORY_LIMITS.facts}): where things live, how things are started or restarted, what a setting really does, what worked. Short plain bullets.
- any topic name (max ${TOPIC_LIMIT} each, up to ${MAX_TOPICS} topics): longer detail on one subject. The first line must say what the file is. Topics are listed in your memory index and opened with read_memory.

Prefer append or replace_section so you never drop what you did not mean to touch. Fix or delete lines that turned out wrong.`,
  inputSchema: updateMemorySchema,
  defaultConsent: "always",
  modifiesState: false,
  mutationTracking: "none",
  requiresBlueprintApproval: false,

  getConsentPreview: (args) => `Update my memory (${args.file})`,

  execute: async (args, ctx: AgentContext) => {
    return updateMemory(ctx.appId, args);
  },
};
