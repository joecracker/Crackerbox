import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

export const OpenRouterBalanceSchema = z.object({
  totalCredits: z.number(),
  totalUsage: z.number(),
  remaining: z.number(),
});

export type OpenRouterBalance = z.infer<typeof OpenRouterBalanceSchema>;

export const openRouterBalanceContracts = {
  // null means no management key has been saved yet.
  getOpenRouterBalance: defineContract({
    channel: "openrouter-balance:get",
    input: z.void(),
    output: OpenRouterBalanceSchema.nullable(),
  }),
} as const;

export const openRouterBalanceClient = createClient(openRouterBalanceContracts);
