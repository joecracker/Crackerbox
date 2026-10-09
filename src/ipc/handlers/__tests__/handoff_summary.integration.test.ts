import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";

import { chats, messages } from "@/db/schema";
import { SUMMARIZE_CHAT_SYSTEM_PROMPT } from "@/prompts/summarize_chat_system_prompt";
import { setModelClientFetchForTesting } from "@/ipc/utils/get_model_client";
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { h } from "@/testing/hybrid.setup";

describe("handoff summary stream (integration)", () => {
  let harness: ChatFlowHarness;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({
      electronMock: h,
      engine: true,
      settings: {
        isTestMode: true,
        enableDyadPro: true,
        providerSettings: {
          auto: { apiKey: { value: "test-dyad-key" } },
          openrouter: { apiKey: { value: "test-openrouter-key" } },
        },
      },
    });
    setModelClientFetchForTesting((input, init) => {
      const url = String(input).replace(
        "https://openrouter.ai/api/v1",
        `${harness.fakeLlmUrl}/openrouter/v1`,
      );
      return fetch(url, init);
    });
  }, 60_000);

  afterAll(async () => {
    setModelClientFetchForTesting(undefined);
    await harness?.dispose();
  });

  it.each(["ask", "plan", "local-agent"] as const)(
    "uses the dedicated prompt, tool, and model for a %s source chat",
    async (chatMode) => {
      const [sourceChat, summaryChat] = await harness.db
        .insert(chats)
        .values([
          {
            appId: harness.appId,
            chatMode,
            modelSelection: {
              provider: "openrouter",
              name: "z-ai/glm-5.3-flashx",
              effortLevel: "medium",
            },
          },
          {
            appId: harness.appId,
            chatMode,
            modelSelection: {
              provider: "openrouter",
              name: "z-ai/glm-5.3-flashx",
              effortLevel: "medium",
            },
          },
        ])
        .returning();
      await harness.db.insert(messages).values({
        chatId: sourceChat.id,
        role: "user",
        content: "[dump] Summarize this completed task.",
      });

      const result = await harness.streamChat(
        `Summarize from chat-id=${sourceChat.id}`,
        { chatId: summaryChat.id },
      );

      expect(result.eventsFor("chat:response:error")).toEqual([]);
      const dump = result.getServerDump({
        type: "request",
        maskModel: false,
      });
      const request = JSON.parse(fs.readFileSync(dump.dumpPath, "utf8")).body;
      expect(request.model).toBe("openrouter/deepseek/deepseek-v4.1-flash");
      expect(request.messages[0]).toEqual({
        role: "system",
        content: SUMMARIZE_CHAT_SYSTEM_PROMPT,
      });
      expect(
        (request.tools ?? []).map(
          (tool: { function?: { name?: string }; name?: string }) =>
            tool.function?.name ?? tool.name,
        ),
      ).toEqual(["set_chat_summary"]);
    },
    60_000,
  );
});
