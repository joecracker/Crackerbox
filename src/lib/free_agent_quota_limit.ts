/**
 * Maximum number of Basic Agent (free tier) messages per quota window.
 *
 * Crackerbox doesn't use Dyad's Pro/free-tier split -- Tim brings his own
 * model key -- so this gate is disabled (effectively unlimited) rather than
 * ripped out, in case the counting plumbing is ever useful again.
 */
export const FREE_AGENT_QUOTA_LIMIT = 1_000_000;
