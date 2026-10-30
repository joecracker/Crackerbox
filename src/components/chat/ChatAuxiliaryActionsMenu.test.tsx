import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

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
vi.mock("./AuxiliaryActionsMenu", () => ({
  AuxiliaryActionsMenu: ({
    handoffItem,
  }: {
    handoffItem?: { label: string; disabled: boolean; onSelect: () => void };
  }): ReactNode =>
    handoffItem ? (
      <button
        type="button"
        data-testid="menu-handoff"
        disabled={handoffItem.disabled}
        onClick={handoffItem.onSelect}
      >
        {handoffItem.label}
      </button>
    ) : null,
}));

import { ChatAuxiliaryActionsMenu } from "./ChatAuxiliaryActionsMenu";

beforeEach(() => {
  h.state.chatId = 7;
  h.state.saved = false;
  h.state.isStreaming = false;
  h.state.writeHandoff = vi.fn();
  h.state.startNewChat = vi.fn();
});
afterEach(() => cleanup());

describe("ChatAuxiliaryActionsMenu", () => {
  it("offers Write handoff, which opens the note box", async () => {
    render(<ChatAuxiliaryActionsMenu onFileSelect={vi.fn()} />);
    expect(screen.getByTestId("menu-handoff").textContent).toBe(
      "Write handoff",
    );
    fireEvent.click(screen.getByTestId("menu-handoff"));
    expect(await screen.findByTestId("handoff-carry-over")).toBeTruthy();
    fireEvent.change(screen.getByTestId("handoff-carry-over"), {
      target: { value: "keep the proof sheet" },
    });
    fireEvent.click(screen.getByTestId("handoff-confirm"));
    expect(h.state.writeHandoff).toHaveBeenCalledWith("keep the proof sheet");
  });

  it("is disabled while a reply is running", () => {
    h.state.isStreaming = true;
    render(<ChatAuxiliaryActionsMenu onFileSelect={vi.fn()} />);
    expect(
      (screen.getByTestId("menu-handoff") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("turns into New chat from handoff once saved, and starts the chat", () => {
    h.state.saved = true;
    render(<ChatAuxiliaryActionsMenu onFileSelect={vi.fn()} />);
    expect(screen.getByTestId("menu-handoff").textContent).toBe(
      "New chat from handoff",
    );
    fireEvent.click(screen.getByTestId("menu-handoff"));
    expect(h.state.startNewChat).toHaveBeenCalledOnce();
    expect(h.state.writeHandoff).not.toHaveBeenCalled();
  });

  it("offers nothing without a chat", () => {
    h.state.chatId = null;
    render(<ChatAuxiliaryActionsMenu onFileSelect={vi.fn()} />);
    expect(screen.queryByTestId("menu-handoff")).toBeNull();
  });
});
