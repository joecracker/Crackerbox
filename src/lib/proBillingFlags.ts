// Kill switch for Dyad's Pro/billing surface (ChatGPT-subscription linking,
// Dyad Pro credits status banner, Pro-gated voice-to-text). The underlying
// code is left in place and untouched; this just stops it from mounting or
// making background network calls to academy.dyad.sh / OpenAI.
//
// This is intentionally a flag-off, not a deletion: see
// claude/crackerbox-pro-billing-followup.md for the full-removal plan.
export const PRO_BILLING_FEATURES_ENABLED = false;