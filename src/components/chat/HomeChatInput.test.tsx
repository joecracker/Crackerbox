import { act, fireEvent, render, screen } from "@testing-library/react";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeChatInput } from "./HomeChatInput";

const mocks = vi.hoisted(() => ({
  apps: [{ id: 1, name: "Existing" }],
  appsLoading: false,
  isMobile: false,
  setInputValue: vi.fn(),
  setSelectedApp: vi.fn(),
  selectedApp: null as null | { id: number; name: string },
  transcription: null as null | ((text: string) => void),
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtom: (atom: { debugLabel?: string }) =>
    atom.debugLabel === "homeSelectedAppAtom"
      ? [mocks.selectedApp, mocks.setSelectedApp]
      : ["Build a notes app", mocks.setInputValue],
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      enableDyadPro: true,
    },
  }),
}));
vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ isStreaming: false }),
}));
vi.mock("@/hooks/useChatModeToggle", () => ({
  useChatModeToggle: () => undefined,
}));
vi.mock("@/hooks/useUserBudgetInfo", () => ({
  useUserBudgetInfo: () => ({ userBudget: { budget: 1 } }),
}));
vi.mock("@/hooks/useTypingPlaceholder", () => ({
  useTypingPlaceholder: () => "something",
}));
vi.mock("@/hooks/useLoadApps", () => ({
  useLoadApps: () => ({
    apps: mocks.apps,
    loading: mocks.appsLoading,
  }),
}));
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mocks.isMobile,
}));
vi.mock("@/hooks/useAttachments", () => ({
  useAttachments: () => ({
    attachments: [],
    isDraggingOver: false,
    pendingFiles: null,
    handleFileSelect: vi.fn(),
    removeAttachment: vi.fn(),
    handleDragOver: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDrop: vi.fn(),
    handlePaste: vi.fn(),
    confirmPendingFiles: vi.fn(),
    cancelPendingFiles: vi.fn(),
  }),
}));
vi.mock("@/hooks/useVoiceToText", () => ({
  useVoiceToText: ({
    onTranscription,
  }: {
    onTranscription: (text: string) => void;
  }) => {
    mocks.transcription = onTranscription;
    return {
      isRecording: false,
      isTranscribing: false,
      toggleRecording: vi.fn(),
    };
  },
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({
    render: trigger,
    children,
  }: {
    render: ReactElement;
    children: ReactNode;
  }) => cloneElement(trigger, {}, children),
  TooltipContent: () => null,
}));
vi.mock("./AttachmentsList", () => ({
  AttachmentsList: () => <button type="button">Remove attachment</button>,
}));
vi.mock("./DragDropOverlay", () => ({ DragDropOverlay: () => null }));
vi.mock("./FileAttachmentTypeDialog", () => ({
  FileAttachmentTypeDialog: () => null,
}));
vi.mock("./LexicalChatInput", () => ({
  LexicalChatInput: ({ disabled }: { disabled: boolean }) => (
    <button type="button" disabled={disabled}>
      Editor
    </button>
  ),
}));
vi.mock("../ChatInputControls", () => ({
  ChatInputControls: () => <button type="button">Change mode</button>,
}));
vi.mock("../ChatModeSelector", () => ({
  ChatModeSelector: () => <button type="button">Basic Agent</button>,
}));
vi.mock("../ModelPicker", () => ({
  ModelPicker: () => <button type="button">DeepSeek V4.1 Flash</button>,
}));
vi.mock("../ImportAppButton", () => ({
  ImportAppButton: () => <button type="button">Import app</button>,
}));
vi.mock("@/components/ImportAppDialog", () => ({
  ImportAppDialog: () => null,
}));
vi.mock("./AuxiliaryActionsMenu", () => ({
  AuxiliaryActionsMenu: () => <button type="button">More actions</button>,
}));
vi.mock("../AppSearchDialog", () => ({ AppSearchDialog: () => null }));
vi.mock("@/pages/home", () => ({}));
vi.mock("@/ipc/types", () => ({
  ipc: { system: { openExternalUrl: vi.fn() } },
}));

describe("HomeChatInput", () => {
  beforeEach(() => {
    mocks.apps = [{ id: 1, name: "Existing" }];
    mocks.appsLoading = false;
    mocks.isMobile = false;
    mocks.setInputValue.mockReset();
    mocks.setSelectedApp.mockReset();
    mocks.selectedApp = null;
    mocks.transcription = null;
  });

  it("makes the entire snapshotted composer inert", () => {
    render(<HomeChatInput onSubmit={vi.fn()} disabled />);

    const composer = screen
      .getByTestId("home-chat-input-container")
      .querySelector('[aria-disabled="true"]');
    expect(composer?.hasAttribute("inert")).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Editor" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId("home-app-selector") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      composer?.contains(screen.getByRole("button", { name: "Change mode" })),
    ).toBe(true);
    expect(
      composer?.contains(screen.getByRole("button", { name: "More actions" })),
    ).toBe(true);
  });

  it("keeps desktop app shortcuts alongside the composer controls", () => {
    render(<HomeChatInput onSubmit={vi.fn()} />);

    const actions = screen.getByTestId("home-chat-actions");
    expect(actions.className).toContain("contents");
    expect(
      actions.contains(screen.getByRole("button", { name: "Import app" })),
    ).toBe(true);
    expect(
      actions.contains(screen.getByRole("button", { name: "More actions" })),
    ).toBe(true);
  });

  it("keeps the phone model beside the plus and exposes the one-turn build action", () => {
    mocks.isMobile = true;
    render(
      <HomeChatInput
        onSubmit={vi.fn()}
        setupAction={<button type="button">Manage AI setup</button>}
      />,
    );

    const composer = screen
      .getByTestId("home-chat-input-container")
      .querySelector('[aria-disabled="false"]')!;
    expect(
      composer.contains(screen.getByRole("button", { name: "Editor" })),
    ).toBe(true);
    expect(
      composer.contains(screen.getByRole("button", { name: "Send message" })),
    ).toBe(true);
    expect(
      composer.contains(screen.getByRole("button", { name: "More actions" })),
    ).toBe(true);
    expect(
      composer.contains(screen.getByRole("button", { name: "Build this" })),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Basic Agent" })).toBeNull();
    expect(
      composer.contains(
        screen.getByRole("button", { name: "DeepSeek V4.1 Flash" }),
      ),
    ).toBe(true);
    expect(
      screen
        .getByTestId("home-chat-mobile-controls")
        .contains(screen.getByRole("button", { name: "Manage AI setup" })),
    ).toBe(true);
  });

  it("ignores a transcription that completes after the payload is locked", () => {
    render(<HomeChatInput onSubmit={vi.fn()} disabled />);

    act(() => mocks.transcription?.("late transcript"));

    expect(mocks.setInputValue).not.toHaveBeenCalled();
  });

  it("shows the app selector only when the loaded list contains an app", () => {
    mocks.appsLoading = true;
    const view = render(<HomeChatInput onSubmit={vi.fn()} />);

    expect(screen.queryByTestId("home-app-selector")).toBeNull();

    mocks.appsLoading = false;
    view.rerender(<HomeChatInput onSubmit={vi.fn()} />);
    expect(screen.getByTestId("home-app-selector")).toBeTruthy();

    mocks.apps = [];
    view.rerender(<HomeChatInput onSubmit={vi.fn()} />);
    expect(screen.queryByTestId("home-app-selector")).toBeNull();
  });

  it("sends chat and build as explicit one-turn capabilities", async () => {
    mocks.selectedApp = { id: 1, name: "Existing" };
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<HomeChatInput onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestedChatMode: "ask" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Build this" }));
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestedChatMode: "local-agent" }),
    );
  });

  it("starts a read-only idea chat when no app is selected", () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<HomeChatInput onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedApp: undefined,
        requestedChatMode: "ask",
      }),
    );
  });
});
