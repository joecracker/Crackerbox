import { z } from "zod";
import { ToolDefinition, AgentContext } from "./types";
import { getHomeAssistantSettings, haRestFetch } from "./ha_client";

const haRestartSchema = z.object({});

const POLL_EVERY_MS = 4_000;
const GIVE_UP_AFTER_MS = 150_000;
const ASSUME_DONE_AFTER_MS = 60_000;

interface CheckConfigResult {
  result?: string;
  errors?: string | null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export const haRestartTool: ToolDefinition<z.infer<typeof haRestartSchema>> = {
  name: "ha_restart",
  description: `Restart Tim's Home Assistant.

- Runs Home Assistant's own configuration check first and refuses to restart if the check fails, so a typo in a file cannot leave it unable to start.
- Home Assistant is offline for about a minute while it restarts: dashboards, automations, voice and presence all pause. Tim is asked to approve every restart.
- Waits to see Home Assistant come back and reports how long it took.
- Only restart when a change really needs it (some configuration files, or a dashboard file that is only read at start-up). Many changes apply without a restart, so do not restart out of habit.`,
  inputSchema: haRestartSchema,
  defaultConsent: "ask",
  modifiesState: true,
  requiresBlueprintApproval: false,

  getConsentPreview: () =>
    "Restart Home Assistant (the configuration is checked first)",

  buildXml: (_args, _isComplete) => "<dyad-ha-restart></dyad-ha-restart>",

  // A restart changes the live Home Assistant, not the app's files.
  shouldTrackMutation: () => false,

  execute: async (_args, ctx: AgentContext) => {
    const ha = getHomeAssistantSettings();

    const checkResponse = await haRestFetch(
      ha,
      "/api/config/core/check_config",
      { method: "POST", body: "{}" },
    );
    const check = (await checkResponse.json()) as CheckConfigResult;
    if (check.result !== "valid") {
      return `Not restarted: Home Assistant's configuration check failed, and restarting now could leave it unable to start. Fix this first:\n${check.errors ?? "(no details were returned)"}`;
    }

    await haRestFetch(ha, "/api/services/homeassistant/restart", {
      method: "POST",
      body: "{}",
    });

    // It can still answer for a few seconds before it shuts down, so only
    // call it back once it has been seen going away and then answering again.
    const startedAt = Date.now();
    let sawOffline = false;
    while (Date.now() - startedAt < GIVE_UP_AFTER_MS) {
      await sleep(POLL_EVERY_MS, ctx.abortSignal);
      if (ctx.abortSignal?.aborted) {
        return "The restart was requested, but the chat was cancelled before I could see Home Assistant come back.";
      }
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      try {
        await haRestFetch(ha, "/api/");
        if (sawOffline) {
          return `Configuration check passed and Home Assistant restarted. It answered again after about ${seconds} seconds.`;
        }
        if (Date.now() - startedAt >= ASSUME_DONE_AFTER_MS) {
          return "Configuration check passed and the restart was requested. I never saw Home Assistant go offline, so it may have restarted quickly; check that it is behaving.";
        }
      } catch {
        sawOffline = true;
      }
    }
    return "Configuration check passed and the restart was requested, but Home Assistant has not answered again yet. Give it another minute before assuming something is wrong.";
  },
};
