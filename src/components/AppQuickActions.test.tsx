import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListedApp } from "@/ipc/types/app";

const h = vi.hoisted(() => ({
  renameApp: vi.fn(),
  deleteApp: vi.fn(),
  showError: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ showError: h.showError }));
vi.mock("@/ipc/types", () => ({
  ipc: { app: { renameApp: h.renameApp, deleteApp: h.deleteApp } },
}));

// Radix menus do not run their select handlers in this test environment
// (verified with a bare Radix menu), so the menu components are replaced by
// plain stand-ins. This tests the card's wiring, not the Radix library.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <div role="menuitem" onClick={() => onSelect?.()}>
      {children}
    </div>
  ),
}));
const { AppQuickRenameDialog } = await import("./AppQuickRenameDialog");
const { AppQuickDeleteDialog } = await import("./AppQuickDeleteDialog");
const { AppShowcaseCard } = await import("./AppShowcaseCard");
const { slugifyAppFolderName } = await import("@/shared/app_names");

const app = {
  id: 7,
  name: "cozy-beaver-chirp",
  path: "cozy-beaver-chirp",
} as unknown as ListedApp;

beforeEach(() => {
  vi.clearAllMocks();
  h.renameApp.mockResolvedValue(undefined);
  h.deleteApp.mockResolvedValue(undefined);
});

describe("AppQuickRenameDialog", () => {
  function setup() {
    const onOpenChange = vi.fn();
    const onRenamed = vi.fn();
    render(
      <AppQuickRenameDialog
        app={app}
        onOpenChange={onOpenChange}
        onRenamed={onRenamed}
      />,
    );
    return { onOpenChange, onRenamed };
  }

  async function typeName(name: string) {
    const input = screen.getByLabelText("New app name");
    await userEvent.clear(input);
    await userEvent.type(input, name);
  }

  it("renames the app and its folder, then refreshes and closes", async () => {
    const { onOpenChange, onRenamed } = setup();
    await typeName("Drywall Estimator");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(h.renameApp).toHaveBeenCalledTimes(1));
    expect(h.renameApp).toHaveBeenCalledWith({
      appId: 7,
      appName: "Drywall Estimator",
      appPath: slugifyAppFolderName("Drywall Estimator"),
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onRenamed).toHaveBeenCalledTimes(1);
  });

  it("keeps the folder when the box is unticked", async () => {
    setup();
    await typeName("Drywall Estimator");
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(h.renameApp).toHaveBeenCalledTimes(1));
    expect(h.renameApp).toHaveBeenCalledWith({
      appId: 7,
      appName: "Drywall Estimator",
      appPath: "cozy-beaver-chirp",
    });
  });

  it("closes without renaming when the name is unchanged", async () => {
    const { onOpenChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(h.renameApp).not.toHaveBeenCalled();
  });

  it("cannot rename to an empty name", async () => {
    setup();
    await typeName("   ");
    const button = screen.getByRole("button", {
      name: "Rename",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("shows the error and stays open when the rename fails", async () => {
    h.renameApp.mockRejectedValue(
      new Error(
        "Error invoking remote method 'rename-app': Error: Folder exists",
      ),
    );
    const { onOpenChange, onRenamed } = setup();
    await typeName("Drywall Estimator");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() =>
      expect(h.showError).toHaveBeenCalledWith("Folder exists"),
    );
    expect(onRenamed).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe("AppQuickDeleteDialog", () => {
  function setup() {
    const onOpenChange = vi.fn();
    const onDeleted = vi.fn();
    render(
      <AppQuickDeleteDialog
        app={app}
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
      />,
    );
    return { onOpenChange, onDeleted };
  }

  it("names the app and warns that deleting is permanent", () => {
    setup();
    expect(screen.getByText('Delete "cozy-beaver-chirp"?')).toBeTruthy();
    expect(screen.getByText(/permanently deleted/)).toBeTruthy();
  });

  it("deletes the app, reports it, and closes", async () => {
    const { onOpenChange, onDeleted } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete app" }));

    await waitFor(() => expect(h.deleteApp).toHaveBeenCalledWith({ appId: 7 }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(7));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not report a deletion that failed", async () => {
    h.deleteApp.mockRejectedValue(new Error("disk busy"));
    const { onDeleted } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete app" }));

    await waitFor(() => expect(h.showError).toHaveBeenCalledTimes(1));
    expect(onDeleted).not.toHaveBeenCalled();
  });
});

describe("AppShowcaseCard menu", () => {
  const menuTrigger = () =>
    screen.getByLabelText("Actions for cozy-beaver-chirp");

  it("offers Rename and Delete and calls the matching handler", () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
    render(
      <AppShowcaseCard
        app={app}
        thumbnailUrl={null}
        onClick={vi.fn()}
        onRename={onRename}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
    expect(onRename).toHaveBeenCalledWith(app);
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(onDelete).toHaveBeenCalledWith(app);
  });

  it("only lists the actions it was given", () => {
    render(
      <AppShowcaseCard
        app={app}
        thumbnailUrl={null}
        onClick={vi.fn()}
        onRename={vi.fn()}
      />,
    );
    expect(screen.getByRole("menuitem", { name: /Rename/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
  });

  it("clicking the menu button or an item does not open the app", () => {
    const onClick = vi.fn();
    render(
      <AppShowcaseCard
        app={app}
        thumbnailUrl={null}
        onClick={onClick}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.click(menuTrigger());
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("has no menu without handlers, or in selection mode", () => {
    const { rerender } = render(
      <AppShowcaseCard app={app} thumbnailUrl={null} onClick={vi.fn()} />,
    );
    expect(screen.queryByLabelText("Actions for cozy-beaver-chirp")).toBeNull();

    rerender(
      <AppShowcaseCard
        app={app}
        thumbnailUrl={null}
        onClick={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        isSelectionMode
      />,
    );
    expect(screen.queryByLabelText("Actions for cozy-beaver-chirp")).toBeNull();
  });

  it("still opens the app when the card itself is clicked", () => {
    const onClick = vi.fn();
    render(
      <AppShowcaseCard
        app={app}
        thumbnailUrl={null}
        onClick={onClick}
        onRename={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("app-showcase-card-cozy-beaver-chirp"));
    expect(onClick).toHaveBeenCalledWith(7);
  });
});
