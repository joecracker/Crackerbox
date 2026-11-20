import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";

const mocks = vi.hoisted(() => ({
  request: vi.fn(() => "request-id"),
  park: vi.fn(),
  ownRows: [] as {
    id: number;
    name: string;
    enabled: boolean;
    catalogSlug: string | null;
  }[],
  neverSlugs: undefined as string[] | undefined,
  tryWriteSettings: vi.fn(() => true),
}));

vi.mock("@/user_input/main", () => ({
  userInputRegistry: {
    request: mocks.request,
    park: mocks.park,
  },
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => ({ neverSuggestPluginSlugs: mocks.neverSlugs }),
  tryWriteSettings: mocks.tryWriteSettings,
}));

// Two queries run against the servers table: every row (the user's own
// plugins) and the row for one id. `eq` carries the id so `where` can tell
// them apart.
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async (condition?: { id?: number }) =>
          mocks.ownRows.filter((row) => row.id === condition?.id),
        then: (resolve: (value: unknown) => unknown) => resolve(mocks.ownRows),
      }),
    }),
  },
}));

vi.mock("@/db/schema", () => ({
  mcpServers: {
    id: "id",
    name: "name",
    catalogSlug: "catalog_slug",
    enabled: "enabled",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (_column: unknown, id: number) => ({ id }),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      debug: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

import {
  collectSuggestablePlugins,
  resetSuggestPluginStateForTests,
  suggestPluginTool,
} from "./suggest_plugin";

const GITHUB = {
  slug: "custom-8",
  name: "Github",
  description: "Read, search and change the user's GitHub repos.",
  localServerId: 8,
};

function resetMocks() {
  vi.clearAllMocks();
  resetSuggestPluginStateForTests();
  mocks.ownRows = [];
  mocks.neverSlugs = undefined;
}

describe("collectSuggestablePlugins", () => {
  beforeEach(resetMocks);

  it("offers an installed plugin that is switched off", async () => {
    mocks.ownRows = [
      { id: 8, name: "Github", enabled: false, catalogSlug: null },
      { id: 9, name: "Ship-check", enabled: true, catalogSlug: null },
    ];
    const result = await collectSuggestablePlugins({ chatId: 1 });
    expect(result.map((p) => p.slug)).toEqual(["custom-8"]);
    expect(result[0].localServerId).toBe(8);
  });

  it("leaves out plugins the user asked never to be offered", async () => {
    mocks.ownRows = [
      { id: 8, name: "Github", enabled: false, catalogSlug: null },
    ];
    mocks.neverSlugs = ["custom-8"];
    expect(await collectSuggestablePlugins({ chatId: 1 })).toEqual([]);
  });

  it("returns nothing when every plugin is already on", async () => {
    mocks.ownRows = [
      { id: 8, name: "Github", enabled: true, catalogSlug: null },
    ];
    expect(await collectSuggestablePlugins({ chatId: 1 })).toEqual([]);
  });
});

describe("suggestPluginTool", () => {
  let onXmlComplete: ReturnType<typeof vi.fn>;

  const context = (overrides: Partial<AgentContext> = {}) =>
    ({
      chatId: 7,
      messageId: 99,
      onXmlComplete,
      suggestablePlugins: [GITHUB],
      ...overrides,
    }) as unknown as AgentContext;

  beforeEach(() => {
    resetMocks();
    onXmlComplete = vi.fn();
  });

  it("is hidden until a suggestable plugin exists", () => {
    expect(
      suggestPluginTool.isEnabled?.(context({ suggestablePlugins: [] })),
    ).toBe(false);
    expect(suggestPluginTool.isEnabled?.(context())).toBe(true);
  });

  it("lists the suggestable plugins in its description", () => {
    const description = suggestPluginTool.getDescription?.(context());
    expect(description).toContain(
      "- custom-8: Github — Read, search and change the user's GitHub repos.",
    );
    expect(
      suggestPluginTool.getDescription?.(context({ suggestablePlugins: [] })),
    ).not.toContain("Plugins available");
  });

  it("persists the pending card with its request id before parking", async () => {
    let parked = false;
    const writtenBeforePark: boolean[] = [];
    mocks.park.mockImplementation(async () => {
      parked = true;
      return { kind: "plugin-suggestion", outcome: "connected" };
    });
    onXmlComplete.mockImplementation(() => {
      writtenBeforePark.push(!parked);
    });

    await suggestPluginTool.execute(
      { slug: "custom-8", reason: "Read the build logs." },
      context(),
    );

    expect(writtenBeforePark).toEqual([true, false]);
    expect(onXmlComplete).toHaveBeenNthCalledWith(
      1,
      '<dyad-suggest-plugin slug="custom-8" name="Github" reason="Read the build logs." request-id="request-id" outcome="pending"></dyad-suggest-plugin>',
    );
    expect(onXmlComplete).toHaveBeenNthCalledWith(
      2,
      '<dyad-suggest-plugin slug="custom-8" name="Github" reason="Read the build logs." outcome="connected"></dyad-suggest-plugin>',
    );
  });

  it("requests a follow-up-capable suggestion and reports a connection", async () => {
    mocks.park.mockResolvedValue({
      kind: "plugin-suggestion",
      outcome: "connected",
    });

    const result = await suggestPluginTool.execute(
      {
        slug: "custom-8",
        reason: "Read the build logs for the failed deploy.",
      },
      context(),
    );

    expect(mocks.request).toHaveBeenCalledWith({
      kind: "plugin-suggestion",
      chatId: 7,
      slug: "custom-8",
      serverName: "Github",
      serverDescription: GITHUB.description,
      needsOAuth: false,
      reason: "Read the build logs for the failed deploy.",
      classifier: "none",
      followUpPrompt:
        "Continue. I have connected the Github plugin. Resume what you needed it for: Read the build logs for the failed deploy.",
    });
    expect(result).toContain("queued a follow-up turn");
  });

  it("tells the agent to continue without a declined plugin", async () => {
    mocks.park.mockResolvedValue({
      kind: "plugin-suggestion",
      outcome: "declined",
    });

    const result = await suggestPluginTool.execute(
      { slug: "custom-8", reason: "Read the build logs." },
      context(),
    );

    expect(result).toContain("declined to connect the Github plugin");
    expect(result).toContain("do not suggest it again");
    expect(mocks.tryWriteSettings).not.toHaveBeenCalled();
    expect(onXmlComplete).toHaveBeenLastCalledWith(
      '<dyad-suggest-plugin slug="custom-8" name="Github" reason="Read the build logs." outcome="declined"></dyad-suggest-plugin>',
    );
  });

  it("stores a never-suggest choice for that plugin", async () => {
    mocks.neverSlugs = ["custom-4"];
    mocks.park.mockResolvedValue({
      kind: "plugin-suggestion",
      outcome: "never",
    });

    const result = await suggestPluginTool.execute(
      { slug: "custom-8", reason: "Read the build logs." },
      context(),
    );

    expect(mocks.tryWriteSettings).toHaveBeenCalledWith(
      { neverSuggestPluginSlugs: ["custom-4", "custom-8"] },
      expect.any(String),
    );
    expect(result).toContain("never suggest it again");
    expect(onXmlComplete).toHaveBeenLastCalledWith(
      '<dyad-suggest-plugin slug="custom-8" name="Github" reason="Read the build logs." outcome="never"></dyad-suggest-plugin>',
    );
  });

  it("still settles the card when the never-suggest choice cannot be stored", async () => {
    mocks.tryWriteSettings.mockReturnValueOnce(false);
    mocks.park.mockResolvedValue({
      kind: "plugin-suggestion",
      outcome: "never",
    });

    const result = await suggestPluginTool.execute(
      { slug: "custom-8", reason: "Read the build logs." },
      context(),
    );

    expect(result).toContain("never suggest it again");
    expect(onXmlComplete).toHaveBeenLastCalledWith(
      '<dyad-suggest-plugin slug="custom-8" name="Github" reason="Read the build logs." outcome="never"></dyad-suggest-plugin>',
    );
  });

  it("treats a swept or timed-out request as dismissed", async () => {
    mocks.park.mockResolvedValue(null);

    const result = await suggestPluginTool.execute(
      { slug: "custom-8", reason: "Read the build logs." },
      context(),
    );

    expect(result).toContain("did not respond");
    expect(onXmlComplete).toHaveBeenLastCalledWith(
      '<dyad-suggest-plugin slug="custom-8" name="Github" reason="Read the build logs." outcome="dismissed"></dyad-suggest-plugin>',
    );
  });

  it("rejects a slug outside the suggestable set without asking the user", async () => {
    const result = await suggestPluginTool.execute(
      { slug: "custom-99", reason: "Open a pull request." },
      context(),
    );

    expect(mocks.request).not.toHaveBeenCalled();
    expect(result).toContain('"custom-99" is not a plugin you can suggest');
    expect(result).toContain("Available slugs: custom-8");
    expect(onXmlComplete).toHaveBeenCalledWith(
      '<dyad-suggest-plugin slug="custom-99" name="custom-99" reason="Open a pull request." outcome="dismissed"></dyad-suggest-plugin>',
    );
  });

  it("refuses a plugin the user already declined this chat, even within the turn", async () => {
    mocks.park.mockResolvedValue({
      kind: "plugin-suggestion",
      outcome: "declined",
    });
    await suggestPluginTool.execute(
      { slug: "custom-8", reason: "Read the build logs." },
      context(),
    );
    mocks.request.mockClear();

    // The turn's suggestable set still lists custom-8.
    const result = await suggestPluginTool.execute(
      { slug: "custom-8", reason: "Read the build logs again." },
      context(),
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(result).toContain("already declined");
  });

  it("refuses a plugin that became usable since the turn started", async () => {
    mocks.ownRows = [
      { id: 8, name: "Github", enabled: true, catalogSlug: null },
    ];

    const result = await suggestPluginTool.execute(
      { slug: "custom-8", reason: "Read the build logs." },
      context(),
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(result).toContain("already connected");
    // No follow-up is armed on this path, so the model must not stop.
    expect(result).toContain("next time the user sends a message");
    expect(result).not.toContain("end your response");
  });

  it("does not park the same plugin twice in one turn after a dismissal", async () => {
    mocks.park.mockResolvedValue(null);
    await suggestPluginTool.execute(
      { slug: "custom-8", reason: "Read the build logs." },
      context(),
    );
    mocks.request.mockClear();

    const sameTurn = await suggestPluginTool.execute(
      { slug: "custom-8", reason: "Read the build logs." },
      context(),
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(sameTurn).toContain("already suggested");

    // A later turn (a new assistant message) may offer it again.
    mocks.park.mockResolvedValue({
      kind: "plugin-suggestion",
      outcome: "connected",
    });
    await expect(
      suggestPluginTool.execute(
        { slug: "custom-8", reason: "Read the build logs." },
        context({ messageId: 100 }),
      ),
    ).resolves.toContain("queued a follow-up turn");
  });

  it("refuses a second suggestion while one is parked in the same chat", async () => {
    let settleFirst!: (value: unknown) => void;
    mocks.park.mockReturnValueOnce(
      new Promise((resolve) => {
        settleFirst = resolve;
      }),
    );
    const first = suggestPluginTool.execute(
      { slug: "custom-8", reason: "Read the build logs." },
      context(),
    );
    await Promise.resolve();

    const second = await suggestPluginTool.execute(
      { slug: "custom-8", reason: "Read the build logs again." },
      context(),
    );
    expect(second).toContain("already waiting for the user");

    settleFirst({ kind: "plugin-suggestion", outcome: "connected" });
    await expect(first).resolves.toContain("queued a follow-up turn");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
