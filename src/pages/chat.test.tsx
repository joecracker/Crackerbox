import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { isPreviewOpenAtom, isChatPanelHiddenAtom } from "@/atoms/viewAtoms";

const resizeCalls = vi.hoisted(() => [] as Array<[string, number]>);

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
      ({ children, id }: { children: React.ReactNode; id: string }, ref) => {
        React.useImperativeHandle(ref, () => ({
          expand() {},
          collapse() {},
          resize(size: number) {
            resizeCalls.push([id, size]);
          },
          // The chat is squeezed to almost nothing when the preview is wide.
          getSize: () => 2,
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

function chatResizes() {
  return resizeCalls.filter(([id]) => id === "chat-panel").map(([, n]) => n);
}

describe("chat page panels", () => {
  beforeEach(() => {
    resizeCalls.length = 0;
  });

  it("shows the chat again, full width, when the preview closes while the chat was hidden", async () => {
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
    expect(chatResizes().at(-1)).toBe(100);
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

  it("after a close, dragging the preview back to half does not push the chat to full width", async () => {
    const store = createStore();
    store.set(isPreviewOpenAtom, true);
    store.set(isChatPanelHiddenAtom, true);
    render(
      <Provider store={store}>
        <ChatPage />
      </Provider>,
    );
    // Close the preview (chat comes back), then open it wide again.
    await act(async () => {
      store.set(isPreviewOpenAtom, false);
    });
    await act(async () => {
      store.set(isPreviewOpenAtom, true);
      store.set(isChatPanelHiddenAtom, true);
    });
    resizeCalls.length = 0;

    // Drag back to half: the chat is no longer hidden while the preview is open.
    await act(async () => {
      store.set(isChatPanelHiddenAtom, false);
    });

    expect(chatResizes()).toEqual([50]);
  });
});
