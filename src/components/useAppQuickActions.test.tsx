import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListedApp } from "@/ipc/types/app";
import { selectedAppIdAtom } from "@/atoms/appAtoms";

const h = vi.hoisted(() => ({
  renameApp: vi.fn(),
  deleteApp: vi.fn(),
  refreshApps: vi.fn(),
  showError: vi.fn(),
}));
vi.mock("@/lib/toast", () => ({ showError: h.showError }));
vi.mock("@/ipc/types", () => ({
  ipc: { app: { renameApp: h.renameApp, deleteApp: h.deleteApp } },
}));
vi.mock("@/hooks/useLoadApps", () => ({
  useLoadApps: () => ({ refreshApps: h.refreshApps }),
}));

const { useAppQuickActions } = await import("./AppQuickActions");

const app = {
  id: 7,
  name: "old-name",
  path: "old-name",
} as unknown as ListedApp;

function Harness() {
  const quick = useAppQuickActions();
  return (
    <div>
      <button onClick={() => quick.onRename(app)}>open rename</button>
      <button onClick={() => quick.onDelete(app)}>open delete</button>
      {quick.dialogs}
    </div>
  );
}

function setup(selectedAppId: number | null = null) {
  const store = createStore();
  store.set(selectedAppIdAtom, selectedAppId);
  render(
    <Provider store={store}>
      <Harness />
    </Provider>,
  );
  return { store };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.renameApp.mockResolvedValue(undefined);
  h.deleteApp.mockResolvedValue(undefined);
  h.refreshApps.mockResolvedValue(undefined);
});

describe("useAppQuickActions", () => {
  it("shows no dialog until an action is chosen", () => {
    setup();
    expect(screen.queryByTestId("app-quick-rename-dialog")).toBeNull();
    expect(screen.queryByTestId("app-quick-delete-dialog")).toBeNull();
  });

  it("renames, refreshes the app list, and closes the dialog", async () => {
    setup();
    fireEvent.click(screen.getByText("open rename"));
    const input = await screen.findByLabelText("New app name");
    await userEvent.clear(input);
    await userEvent.type(input, "Drywall Estimator");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(h.renameApp).toHaveBeenCalledTimes(1));
    expect(h.renameApp).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 7, appName: "Drywall Estimator" }),
    );
    await waitFor(() => expect(h.refreshApps).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByTestId("app-quick-rename-dialog")).toBeNull(),
    );
  });

  it("deletes, refreshes the list, and closes the dialog", async () => {
    setup();
    fireEvent.click(screen.getByText("open delete"));
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete app" }),
    );

    await waitFor(() => expect(h.deleteApp).toHaveBeenCalledWith({ appId: 7 }));
    await waitFor(() => expect(h.refreshApps).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByTestId("app-quick-delete-dialog")).toBeNull(),
    );
  });

  it("clears the open app when that same app is deleted", async () => {
    const { store } = setup(7);
    fireEvent.click(screen.getByText("open delete"));
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete app" }),
    );

    await waitFor(() => expect(store.get(selectedAppIdAtom)).toBeNull());
  });

  it("leaves a different open app alone when another one is deleted", async () => {
    const { store } = setup(99);
    fireEvent.click(screen.getByText("open delete"));
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete app" }),
    );

    await waitFor(() => expect(h.deleteApp).toHaveBeenCalled());
    expect(store.get(selectedAppIdAtom)).toBe(99);
  });

  it("does not refresh the list when the delete fails", async () => {
    h.deleteApp.mockRejectedValue(new Error("disk busy"));
    setup();
    fireEvent.click(screen.getByText("open delete"));
    await userEvent.click(
      await screen.findByRole("button", { name: "Delete app" }),
    );

    await waitFor(() => expect(h.showError).toHaveBeenCalledTimes(1));
    expect(h.refreshApps).not.toHaveBeenCalled();
  });
});
