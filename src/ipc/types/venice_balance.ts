import { z } from "zod";
import { defineContract, createClient } from "../contracts/core";

export const VeniceBalanceSchema = z.object({
  usd: z.number(),
  diem: z.number(),
  bundledCredits: z.number(),
  earnedCredits: z.number(),
  // Which balance Venice spends next: DIEM, EARNED_CREDITS, BUNDLED_CREDITS,
  // USD, or null when everything is empty.
  consumptionCurrency: z.string().nullable(),
  canConsume: z.boolean(),
});

export type VeniceBalance = z.infer<typeof VeniceBalanceSchema>;

export const veniceBalanceContracts = {
  // null means no Venice key has been set up yet.
  getVeniceBalance: defineContract({
    channel: "venice-balance:get",
    input: z.void(),
    output: VeniceBalanceSchema.nullable(),
  }),
} as const;

export const veniceBalanceClient = createClient(veniceBalanceContracts);
