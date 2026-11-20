// Kill switch for what is left of Dyad's Pro/billing surface (ChatGPT-subscription
// linking). The banner, voice-to-text and upgrade prompts are gone; the code
// that remains is left in place and untouched, and this just stops it from
// mounting or making background network calls to academy.dyad.sh / OpenAI.
//
// This is intentionally a flag-off, not a deletion.
export const PRO_BILLING_FEATURES_ENABLED = false;
