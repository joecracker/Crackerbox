import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  state: {
    chatId: 7 as number | null,
    saved: false,
    isStreaming: false,
    writeHandoff: vi.fn(),
    startNewChat: vi.fn(),
  },
}));
vi.mock("@/hooks/useHandoff", () => ({ useHandoff: () => h.state }));

import { HandoffButton } from "./HandoffButton";

beforeEach(() => {
  h.state.chatId = 7;
  h.state.saved = false;
  h.state.isStreaming = false;
  h.state.writeHandoff = vi.fn();
  h.state.startNewChat = vi.fn();
});
afterEach(() => cleanup());

describe("HandoffButton", () => {
  it("offers Write handoff before one is saved", () => {
    render(<HandoffButton />);
    expect(screen.getByTestId("write-handoff").textContent).toContain(
      "Write handoff",
    );
    expect(screen.queryByTestId("new-chat-from-handoff")).toBeNull();
  });

  it("asks for an optional note, then writes the handoff with it", async () => {
    render(<HandoffButton />);
    fireEvent.click(screen.getByTestId("write-handoff"));
    const note = await screen.findByTestId("handoff-carry-over");
    fireEvent.change(note, { target: { value: "keep the proof sheet" } });
    fireEvent.click(screen.getByTestId("handoff-confirm"));
    expect(h.state.writeHandoff).toHaveBeenCalledWith("keep the proof sheet");
    expect(h.state.startNewChat).not.toHaveBeenCalled();
  });

  it("is disabled while a reply is still running", () => {
    h.state.isStreaming = true;
    render(<HandoffButton />);
    expect(
      (screen.getByTestId("write-handoff") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("turns into New chat once the handoff is saved, and only then opens a chat", () => {
    h.state.saved = true;
    render(<HandoffButton />);
    expect(screen.queryByTestId("write-handoff")).toBeNull();
    fireEvent.click(screen.getByTestId("new-chat-from-handoff"));
    expect(h.state.startNewChat).toHaveBeenCalledOnce();
    expect(h.state.writeHandoff).not.toHaveBeenCalled();
  });

  it("shows nothing without a chat", () => {
    h.state.chatId = null;
    const { container } = render(<HandoffButton />);
    expect(container.innerHTML).toBe("");
  });
});
