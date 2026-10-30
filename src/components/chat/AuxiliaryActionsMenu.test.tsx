import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ handoffCalls: 0 }));

// The handoff hooks only work on a chat page. If the shared menu (which the
// home page also shows) ever calls them again, the home page fails to load
// with "Invariant failed". This makes that fail here instead.
vi.mock("@/hooks/useHandoff", () => ({
  useHandoff: () => {
    h.handoffCalls += 1;
    throw new Error("useHandoff is for chat pages only");
  },
  useHandoffStatus: () => {
    h.handoffCalls += 1;
    throw new Error("useHandoffStatus is for chat pages only");
  },
}));
vi.mock("@/hooks/useThemes", () => ({ useThemes: () => ({ themes: [] }) }));
vi.mock("@/hooks/useAppTheme", () => ({
  useAppTheme: () => ({ themeId: null }),
}));
vi.mock("@/hooks/useCustomThemes", () => ({
  useCustomThemes: () => ({ customThemes: [] }),
}));
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: {}, updateSettings: vi.fn() }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/ipc/types", () => ({ ipc: { template: { setAppTheme: vi.fn() } } }));
vi.mock("./FileAttachmentDropdown", () => ({
  FileAttachmentDropdown: () => null,
}));
vi.mock("@/components/CustomThemeDialog", () => ({
  CustomThemeDialog: () => null,
}));

import { AuxiliaryActionsMenu } from "./AuxiliaryActionsMenu";

afterEach(() => {
  cleanup();
  h.handoffCalls = 0;
});

describe("AuxiliaryActionsMenu", () => {
  it("renders without the chat-only handoff hooks (the home page uses it)", () => {
    render(<AuxiliaryActionsMenu onFileSelect={vi.fn()} />);
    expect(screen.getByTestId("auxiliary-actions-menu")).toBeTruthy();
    expect(h.handoffCalls).toBe(0);
  });

  it("has no handoff entry unless a chat page hands it one", () => {
    render(<AuxiliaryActionsMenu onFileSelect={vi.fn()} />);
    fireEvent.click(screen.getByTestId("auxiliary-actions-menu"));
    expect(screen.queryByTestId("handoff-menu-item")).toBeNull();
  });

  it("shows the handoff entry a chat page hands it, and runs it", async () => {
    const onSelect = vi.fn();
    render(
      <AuxiliaryActionsMenu
        onFileSelect={vi.fn()}
        handoffItem={{ label: "Write handoff", disabled: false, onSelect }}
      />,
    );
    fireEvent.click(screen.getByTestId("auxiliary-actions-menu"));
    const item = await screen.findByTestId("handoff-menu-item");
    expect(item.textContent).toContain("Write handoff");
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
