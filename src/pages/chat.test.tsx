import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { isPreviewOpenAtom, isChatPanelHiddenAtom } from "@/atoms/viewAtoms";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({ id: 1, appId: 1 }),
}));
vi.mock("react-resizable-panels", async () => {
  const React = await import("react");
  return {
    PanelGroup: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    Panel: React.forwardRef(
      ({ children }: { children: React.ReactNode }, ref) => {
        React.useImperativeHandle(ref, () => ({
          expand() {},
          collapse() {},
          resize() {},
          getSize: () => 50,
        }));
        return <div>{children}</div>;
      },
    ),
    PanelResizeHandle: () => <div />,
  };
});
vi.mock("../components/ChatPanel", () => ({
  ChatPanel: () => <div data-testid="chat-panel-content">chat</div>,
}));
vi.mock("../components/preview_panel/PreviewPanel", () => ({
  PreviewPanel: () => <div />,
}));
vi.mock("@/hooks/useChats", () => ({
  useChats: () => ({ chats: [{ id: 1, appId: 1 }], loading: false }),
}));
vi.mock("@/ipc/types", () => ({
  ipc: { chat: { getChat: vi.fn().mockResolvedValue({ appId: 1 }) } },
}));

import ChatPage from "./chat";

describe("chat page panels", () => {
  it("shows the chat again when the preview closes while the chat was hidden", async () => {
    const store = createStore();
    store.set(isPreviewOpenAtom, true);
    store.set(isChatPanelHiddenAtom, true);
    render(
      <Provider store={store}>
        <ChatPage />
      </Provider>,
    );
    expect(screen.queryByTestId("chat-panel-content")).toBeNull();

    await act(async () => {
      store.set(isPreviewOpenAtom, false);
    });

    expect(store.get(isChatPanelHiddenAtom)).toBe(false);
    expect(screen.getByTestId("chat-panel-content")).toBeTruthy();
  });

  it("leaves a hidden chat alone while the preview is still open", async () => {
    const store = createStore();
    store.set(isPreviewOpenAtom, true);
    store.set(isChatPanelHiddenAtom, true);
    render(
      <Provider store={store}>
        <ChatPage />
      </Provider>,
    );
    expect(store.get(isChatPanelHiddenAtom)).toBe(true);
    expect(screen.queryByTestId("chat-panel-content")).toBeNull();
  });
});
