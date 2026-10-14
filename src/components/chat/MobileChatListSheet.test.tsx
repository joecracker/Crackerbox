import { act, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { MobileChatListSheet } from "./MobileChatListSheet";

vi.mock("@/components/ChatList", () => ({
  ChatList: () => (
    <div data-testid="chat-list-stub">
      <button type="button" data-testid="chat-list-item-7">
        Old chat
      </button>
    </div>
  ),
}));

function renderSheet(open: boolean) {
  const store = createStore();
  store.set(selectedChatIdAtom, 3);
  const onOpenChange = vi.fn();
  render(
    <Provider store={store}>
      <MobileChatListSheet open={open} onOpenChange={onOpenChange} />
    </Provider>,
  );
  return { store, onOpenChange };
}

describe("MobileChatListSheet", () => {
  it("shows nothing while closed", () => {
    renderSheet(false);
    expect(screen.queryByTestId("chat-list-stub")).toBeNull();
  });

  it("shows the chat list when open and does not close by itself", () => {
    const { onOpenChange } = renderSheet(true);
    expect(screen.getByTestId("chat-list-stub")).toBeTruthy();
    expect(screen.getByText("Chats")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes when a chat row is tapped, even the one already open", () => {
    const { onOpenChange } = renderSheet(true);
    fireEvent.click(screen.getByTestId("chat-list-item-7"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes when a different chat gets selected", () => {
    const { store, onOpenChange } = renderSheet(true);
    act(() => {
      store.set(selectedChatIdAtom, 9);
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
