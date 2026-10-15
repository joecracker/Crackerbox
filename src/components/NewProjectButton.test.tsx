import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(),
  selectChat: vi.fn(),
  exists: false,
}));

vi.mock("@/hooks/useCreateApp", () => ({
  useCreateApp: () => ({ createApp: mocks.createApp }),
}));
vi.mock("@/hooks/useSelectChat", () => ({
  useSelectChat: () => ({ selectChat: mocks.selectChat }),
}));
vi.mock("@/hooks/useCheckName", () => ({
  useCheckName: () => ({
    data: { exists: mocks.exists },
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: (value: string) => value,
}));

import { NewProjectButton } from "./NewProjectButton";

function openDialog() {
  render(<NewProjectButton />);
  fireEvent.click(screen.getByTestId("new-project-button"));
}

describe("NewProjectButton", () => {
  beforeEach(() => {
    mocks.createApp.mockReset();
    mocks.selectChat.mockReset();
    mocks.exists = false;
  });

  it("shows only the button until it is tapped", () => {
    render(<NewProjectButton />);
    expect(screen.getByText("New Project")).toBeTruthy();
    expect(screen.queryByLabelText("Project name")).toBeNull();
  });

  it("creates the project and opens its first chat", async () => {
    mocks.createApp.mockResolvedValue({ app: { id: 12 }, chatId: 34 });
    openDialog();

    const create = screen.getByRole("button", { name: "Create project" });
    expect((create as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "  Garage Remodel " },
    });
    fireEvent.click(create);

    await waitFor(() =>
      expect(mocks.selectChat).toHaveBeenCalledWith({ chatId: 34, appId: 12 }),
    );
    expect(mocks.createApp).toHaveBeenCalledWith({ name: "Garage Remodel" });
    await waitFor(() =>
      expect(screen.queryByLabelText("Project name")).toBeNull(),
    );
  });

  it("will not create a project whose name is taken", () => {
    mocks.exists = true;
    openDialog();

    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Bubbles" },
    });

    expect(
      screen.getByText("A project with that name already exists."),
    ).toBeTruthy();
    const create = screen.getByRole("button", { name: "Create project" });
    expect((create as HTMLButtonElement).disabled).toBe(true);
  });
});
