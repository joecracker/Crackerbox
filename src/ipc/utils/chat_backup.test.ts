import { streamText } from "ai";
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { APICallError } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  createBackupNotifier,
  createChatBackupModel,
  shouldUseChatBackup,
  withBackupRouting,
  withChatBackup,
  CHAT_BACKUP_MODEL,
} from "./chat_backup";

function streamOf(text: string): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] } as any);
      controller.enqueue({ type: "text-start", id: "1" } as any);
      controller.enqueue({ type: "text-delta", id: "1", delta: text } as any);
      controller.enqueue({ type: "text-end", id: "1" } as any);
      controller.enqueue({
        type: "finish",
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
      } as any);
      controller.close();
    },
  });
}

function fakeModel(modelId: string, behave: () => string): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId,
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not used");
    },
    async doStream() {
      return { stream: streamOf(behave()) };
    },
  } as LanguageModelV3;
}

function failingModel(modelId: string, statusCode: number): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId,
    supportedUrls: {},
    async doGenerate() {
      throw new Error("not used");
    },
    async doStream() {
      throw new APICallError({
        message: "failed",
        url: "https://venice.test",
        requestBodyValues: {},
        statusCode,
        isRetryable: statusCode >= 500,
      });
    },
  } as LanguageModelV3;
}

async function run(model: LanguageModelV3 | any): Promise<string> {
  const result = streamText({ model, prompt: "hello", maxRetries: 0 });
  return await result.text;
}

describe("chat backup", () => {
  it("only applies to custom providers", () => {
    expect(shouldUseChatBackup("custom")).toBe(true);
    expect(shouldUseChatBackup("cloud")).toBe(false);
    expect(shouldUseChatBackup(undefined)).toBe(false);
  });

  it("makes no backup without an OpenRouter key", () => {
    expect(
      createChatBackupModel({ apiKey: undefined, primaryName: "venice/x" }),
    ).toBeUndefined();
    const primary = fakeModel("main", () => "hi");
    expect(withChatBackup(primary, undefined)).toBe(primary);
  });

  it("answers with the backup when the main model is down", async () => {
    const chain = withChatBackup(
      failingModel("main", 503),
      fakeModel(CHAT_BACKUP_MODEL, () => "from backup"),
    );
    expect(await run(chain)).toBe("from backup");
  });

  it("does not touch the backup when the main model works", async () => {
    const backupCall = vi.fn(() => "from backup");
    const chain = withChatBackup(
      fakeModel("main", () => "from main"),
      fakeModel(CHAT_BACKUP_MODEL, backupCall),
    );
    expect(await run(chain)).toBe("from main");
    expect(backupCall).not.toHaveBeenCalled();
  });

  it("does not switch on a 400-class error (a refusal or a bad request)", async () => {
    const backupCall = vi.fn(() => "from backup");
    const chain = withChatBackup(
      failingModel("main", 400),
      fakeModel(CHAT_BACKUP_MODEL, backupCall),
    );
    await expect(run(chain)).rejects.toThrow();
    expect(backupCall).not.toHaveBeenCalled();
  });
});

describe("withBackupRouting", () => {
  it("adds no-data-collection and skips Venice, keeping other fields", async () => {
    const base = vi.fn(async () => new Response("{}"));
    const f = withBackupRouting(base as any);
    await f("https://x.test", {
      method: "POST",
      body: JSON.stringify({
        model: "m",
        messages: [],
        provider: { sort: "price" },
      }),
    });
    const sent = JSON.parse((base.mock.calls[0] as any)[1].body);
    expect(sent.model).toBe("m");
    expect(sent.provider).toEqual({
      sort: "price",
      data_collection: "deny",
      ignore: ["Venice"],
    });
  });

  it("passes a non-JSON body through untouched", async () => {
    const base = vi.fn(async () => new Response("{}"));
    const f = withBackupRouting(base as any);
    await f("https://x.test", { method: "POST", body: "not json" });
    expect((base.mock.calls[0] as any)[1].body).toBe("not json");
  });
});

describe("createBackupNotifier", () => {
  it("fires once, then again only after the interval", () => {
    const onUsed = vi.fn();
    let t = 1000;
    const notify = createBackupNotifier(onUsed, 100, () => t);
    notify();
    notify();
    expect(onUsed).toHaveBeenCalledTimes(1);
    t += 101;
    notify();
    expect(onUsed).toHaveBeenCalledTimes(2);
  });

  it("never throws if the notice fails", () => {
    const notify = createBackupNotifier(() => {
      throw new Error("boom");
    });
    expect(() => notify()).not.toThrow();
  });
});
