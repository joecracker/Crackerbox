import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider, createStore } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  streamMessage: vi.fn(),
  isStreaming: false,
  createChat: vi.fn(),
  getChat: vi.fn(),
  getHandoffStatus: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));
vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({
    streamMessage: h.streamMessage,
    isStreaming: h.isStreaming,
  }),
}));
vi.mock("@/ipc/types", () => ({
  ipc: {
    chat: {
      createChat: h.createChat,
      getChat: h.getChat,
      getHandoffStatus: h.getHandoffStatus,
    },
  },
}));
vi.mock("@/lib/toast", () => ({ showError: h.showError }));

import { useHandoff } from "./useHandoff";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { HANDOFF_START_LINE } from "@/prompts/handoff_prompts";

function setup(appId: number | null) {
  const store = createStore();
  store.set(selectedChatIdAtom, 7);
  store.set(selectedAppIdAtom, appId);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </Provider>
  );
  return renderHook(() => useHandoff(), { wrapper });
}

describe("useHandoff.startNewChat", () => {
  beforeEach(() => {
    h.navigate.mockReset();
    h.streamMessage.mockReset().mockResolvedValue(true);
    h.createChat.mockReset().mockResolvedValue(99);
    h.getChat.mockReset().mockResolvedValue({ id: 7, appId: 44 });
    h.getHandoffStatus.mockReset().mockResolvedValue({ saved: true });
    h.showError.mockReset();
    h.isStreaming = false;
  });

  it("opens a new chat in the same app and starts it with the plain line", async () => {
    const { result } = setup(3);
    await act(async () => {
      await result.current.startNewChat();
    });
    expect(h.createChat).toHaveBeenCalledWith({
      appId: 3,
      initialChatMode: "local-agent",
    });
    expect(h.navigate).toHaveBeenCalledWith({
      to: "/chat",
      search: { id: 99 },
    });
    expect(h.streamMessage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: HANDOFF_START_LINE, chatId: 99 }),
    );
  });

  it("still works when the handoff write never reported that it settled", async () => {
    // writeHandoff takes its lock; the stream's "settled" callback never comes.
    h.streamMessage.mockResolvedValueOnce(true);
    const { result } = setup(3);
    await act(async () => {
      await result.current.writeHandoff();
    });
    await act(async () => {
      await result.current.startNewChat();
    });
    expect(h.createChat).toHaveBeenCalledTimes(1);
    expect(h.navigate).toHaveBeenCalled();
  });

  it("finds the app from the chat when the page forgot which app is open", async () => {
    const { result } = setup(null);
    await act(async () => {
      await result.current.startNewChat();
    });
    expect(h.getChat).toHaveBeenCalledWith(7);
    expect(h.createChat).toHaveBeenCalledWith({
      appId: 44,
      initialChatMode: "local-agent",
    });
  });

  it("says so, instead of doing nothing, when the app cannot be found", async () => {
    h.getChat.mockResolvedValue({ id: 7, appId: null });
    const { result } = setup(null);
    await act(async () => {
      await result.current.startNewChat();
    });
    expect(h.showError).toHaveBeenCalledWith(
      expect.stringContaining("which app"),
    );
    expect(h.createChat).not.toHaveBeenCalled();
  });

  it("shows the error when opening the chat fails, and can be tried again", async () => {
    h.createChat.mockRejectedValueOnce(new Error("no database"));
    const { result } = setup(3);
    await act(async () => {
      await result.current.startNewChat();
    });
    expect(h.showError).toHaveBeenCalled();
    await act(async () => {
      await result.current.startNewChat();
    });
    expect(h.createChat).toHaveBeenCalledTimes(2);
    expect(h.navigate).toHaveBeenCalledTimes(1);
  });

  it("ignores a second click while the first is still opening", async () => {
    let release: (id: number) => void = () => {};
    h.createChat.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = setup(3);
    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.startNewChat();
      await result.current.startNewChat();
    });
    expect(h.createChat).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(99);
      await first;
    });
    expect(h.navigate).toHaveBeenCalledTimes(1);
  });
});
