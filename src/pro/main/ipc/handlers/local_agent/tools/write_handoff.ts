import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";
import {
  MAX_GAME_PLAN_ITEMS,
  MAX_ITEM_CHARS,
  MAX_QUESTIONS,
  writeHandoff,
} from "../agent_handoff";
import { MEMORY_LIMITS } from "../agent_memory";

const writeHandoffSchema = z.object({
  doing_now: z
    .string()
    .describe(
      "What was in progress when this chat ends: the last step that was finished, anything half-done (file names, the command or change under way), and the single next step.",
    ),
  game_plan: z
    .array(z.string())
    .describe(
      `${MAX_GAME_PLAN_ITEMS} items at most, each under ${MAX_ITEM_CHARS} characters: short bullets of what you propose to do next, in the order you would do them. You work from these once the user answers the opening question.`,
    ),
  questions: z
    .array(z.string())
    .describe(
      `${MAX_QUESTIONS} at most, each under ${MAX_ITEM_CHARS} characters: plain questions to put to the user to open the new chat, for example "Do you want to do X, or Y first?".`,
    ),
  new_decisions: z
    .array(z.string())
    .optional()
    .describe(
      `Approaches that failed or that the user ruled out, and rules the user stated, that are not in your decisions memory yet. One line each (under ${MAX_ITEM_CHARS} characters): what is out and why.`,
    ),
  new_facts: z
    .array(z.string())
    .optional()
    .describe(
      `New things you learned that are not in your facts memory yet: where things live, how things start or restart, what a setting really does. One line each, under ${MAX_ITEM_CHARS} characters; split a long fact into two.`,
    ),
  carry_over: z
    .string()
    .optional()
    .describe("Anything the user asked to carry over, in their words."),
});

export const writeHandoffTool: ToolDefinition<
  z.infer<typeof writeHandoffSchema>
> = {
  name: "write_handoff",
  description: `Write the handoff for a new chat. Use it only when the user asks you to write the handoff. Call it once, as your only action that turn, then reply with one short line saying it is saved.

The new chat starts with your memory in front of it and nothing else from this chat, so write for a fresh you who remembers nothing. It saves into your memory: the state (max ${MEMORY_LIMITS.state} characters in total) is replaced with doing_now, game_plan, questions and carry_over; new_decisions and new_facts are added to your decisions and facts files. Do not repeat what those files already say. If a line in them is wrong or stale, fix it first with update_memory. If decisions or facts are full, the oldest lines are moved to an archive topic for you (topics/decisions-archive, topics/facts-archive), so never condense them just to make room.

The new chat opens by asking the user the questions, with no list and no recap, so make them specific and worth answering, and name the real options inside them. The game plan is what you will work from once the user answers. Do not summarize what was done.`,
  inputSchema: writeHandoffSchema,
  defaultConsent: "always",
  modifiesState: false,
  mutationTracking: "none",
  requiresBlueprintApproval: false,

  getConsentPreview: () => "Write the handoff for a new chat",

  execute: async (args, ctx: AgentContext) => {
    return writeHandoff(ctx.appId, ctx.chatId, {
      doingNow: args.doing_now,
      gamePlan: args.game_plan,
      questions: args.questions,
      newDecisions: args.new_decisions,
      newFacts: args.new_facts,
      carryOver: args.carry_over,
    });
  },
};
