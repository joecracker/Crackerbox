import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { DyadSuggestPlugin } from "./DyadSuggestPlugin";

const mocks = vi.hoisted(() => ({
  pending: new Map<number, unknown>(),
  respond: vi.fn(async () => true),
  probeConnection: vi.fn(),
  updateServer: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string }) => {
      switch (key) {
        case "suggestPlugin.badge":
          return "Plugin suggestion";
        case "suggestPlugin.title":
          return `Connect ${values?.name}?`;
        case "suggestPlugin.connect":
          return `Connect ${values?.name}`;
        case "suggestPlugin.notNow":
          return "Not now";
        case "suggestPlugin.connectedTitle":
          return `${values?.name} connected`;
        case "suggestPlugin.declinedTitle":
          return `Skipped ${values?.name}`;
        case "suggestPlugin.never":
          return "Don't suggest again";
        case "suggestPlugin.neverTitle":
          return `Won't suggest ${values?.name} again`;
        default:
          return key;
      }
    },
  }),
}));

vi.mock("@/user_input/hooks", () => ({
  usePendingPluginSuggestions: () => mocks.pending,
  useUserInputReadModel: () => ({ respond: mocks.respond }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    mcp: {
      probeConnection: mocks.probeConnection,
      updateServer: mocks.updateServer,
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: mocks.showError,
}));

const PENDING = {
  chatId: 7,
  requestId: "plugin-suggestion:1",
  slug: "custom-42",
  serverName: "Vercel",
  serverDescription: "Deployments and logs.",
  needsOAuth: false,
  reason: "Read the build logs for the failed deploy.",
  isResponding: false,
};
const CREATED = {
  id: 42,
  enabled: true,
  oauthEnabled: false,
  oauthConnected: false,
  oauthCallbackPort: null,
};

function renderCard(
  props: Partial<Parameters<typeof DyadSuggestPlugin>[0]> = {},
) {
  const store = createStore();
  store.set(selectedChatIdAtom, 7);
  const queryClient = new QueryClient();
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>
  );
  return render(
    <DyadSuggestPlugin
      slug="custom-42"
      name="Vercel"
      reason={PENDING.reason}
      requestId={PENDING.requestId}
      outcome="pending"
      {...props}
    />,
    { wrapper: Wrapper },
  );
}

const connectButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "Connect Vercel" });

describe("DyadSuggestPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pending = new Map([[7, PENDING]]);
    mocks.updateServer.mockResolvedValue(CREATED);
    mocks.probeConnection.mockResolvedValue({ status: "ok", error: null });
  });

  it("shows the agent's reason with one-click connect and decline", () => {
    renderCard();

    expect(screen.getByText("Connect Vercel?")).toBeTruthy();
    expect(screen.getByText(PENDING.reason)).toBeTruthy();
    expect(screen.getByText("Deployments and logs.")).toBeTruthy();
    expect(connectButton().disabled).toBe(false);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Not now" })
        .disabled,
    ).toBe(false);
  });

  it("switches the plugin on, probes it, and reports the connection", async () => {
    renderCard();

    fireEvent.click(connectButton());

    await waitFor(() =>
      expect(mocks.respond).toHaveBeenCalledWith("plugin-suggestion:1", {
        kind: "plugin-suggestion",
        outcome: "connected",
      }),
    );
    expect(mocks.updateServer).toHaveBeenCalledWith({ id: 42, enabled: true });
    expect(mocks.probeConnection).toHaveBeenCalledWith(42);
  });

  it("does not report a plugin whose server is unreachable", async () => {
    mocks.probeConnection.mockResolvedValue({
      status: "error",
      error: "connect ECONNREFUSED",
    });
    renderCard();

    fireEvent.click(connectButton());

    // Localized headline first, raw transport text as detail.
    await waitFor(() =>
      expect(mocks.showError).toHaveBeenCalledWith(
        "suggestPlugin.unreachable\nconnect ECONNREFUSED",
      ),
    );
    expect(mocks.respond).not.toHaveBeenCalled();
    expect(connectButton().disabled).toBe(false);
    // The failure stays on the card after the toast is gone.
    expect(screen.getByRole("alert").textContent).toBe(
      "suggestPlugin.unreachable",
    );
  });

  it("tells the user to authorize when the probe is rejected with 401", async () => {
    mocks.probeConnection.mockResolvedValue({
      status: "unauthorized",
      error: "HTTP 401",
    });
    renderCard();

    fireEvent.click(connectButton());

    await waitFor(() =>
      expect(mocks.showError).toHaveBeenCalledWith(
        "suggestPlugin.authRequired\nHTTP 401",
      ),
    );
    expect(mocks.respond).not.toHaveBeenCalled();
  });

  it("stays busy after a successful connect until the card settles", async () => {
    renderCard();

    fireEvent.click(connectButton());

    await waitFor(() => expect(mocks.respond).toHaveBeenCalled());
    expect(
      screen.getByTestId<HTMLButtonElement>("plugin-suggestion-connect-button")
        .disabled,
    ).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("answers never when the user opts out of the plugin for good", async () => {
    renderCard();

    fireEvent.click(
      screen.getByRole("button", { name: "Don't suggest again" }),
    );

    await waitFor(() =>
      expect(mocks.respond).toHaveBeenCalledWith("plugin-suggestion:1", {
        kind: "plugin-suggestion",
        outcome: "never",
      }),
    );
    expect(mocks.updateServer).not.toHaveBeenCalled();
  });

  it("declines without adding anything", async () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    await waitFor(() =>
      expect(mocks.respond).toHaveBeenCalledWith("plugin-suggestion:1", {
        kind: "plugin-suggestion",
        outcome: "declined",
      }),
    );
    expect(mocks.updateServer).not.toHaveBeenCalled();
  });

  it("renders terminal outcomes with the reason from the persisted card", () => {
    mocks.pending = new Map();

    const { unmount } = renderCard({ name: "Vercel", outcome: "connected" });
    expect(screen.getByText("Vercel connected")).toBeTruthy();
    expect(screen.getByText(PENDING.reason)).toBeTruthy();
    unmount();

    const declined = renderCard({ name: "Vercel", outcome: "declined" });
    expect(screen.getByText("Skipped Vercel")).toBeTruthy();
    expect(screen.getByText(PENDING.reason)).toBeTruthy();
    declined.unmount();

    renderCard({ name: "Vercel", outcome: "never" });
    expect(screen.getByText("Won't suggest Vercel again")).toBeTruthy();
  });

  it("hides a pending card whose request is no longer live", () => {
    mocks.pending = new Map();

    const { container } = renderCard();
    expect(container.innerHTML).toBe("");
  });

  it("treats a card for another request as historical, even for the same plugin", () => {
    mocks.pending = new Map([
      [7, { ...PENDING, requestId: "plugin-suggestion:2" }],
    ]);

    const { container } = renderCard();
    expect(container.innerHTML).toBe("");
  });

  it("never activates a card without a request id, such as the streaming preview", () => {
    const { container } = renderCard({ requestId: undefined });
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a dismissed card even while a request is live", () => {
    const { container } = renderCard({ outcome: "dismissed" });
    expect(container.innerHTML).toBe("");
  });
});
