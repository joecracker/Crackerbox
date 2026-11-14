import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddEntityDialog } from "./AddEntityDialog";

const mocks = vi.hoisted(() => ({
  selectedModel: { name: "claude-sonnet-4-6", provider: "anthropic" } as {
    name: string;
    provider: string;
    connection?: string;
  },
  addEntity: vi.fn(),
  openApp: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({ settings: { selectedModel: mocks.selectedModel } }),
}));
vi.mock("@/hooks/useOpenApp", () => ({ useOpenApp: () => mocks.openApp }));
vi.mock("@/ipc/types", () => ({
  ipc: { chat: { addEntity: mocks.addEntity } },
}));

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AddEntityDialog open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

const slider = () =>
  screen.getByTestId("add-entity-temperament-slider") as HTMLInputElement;

beforeEach(() => {
  mocks.selectedModel = { name: "claude-sonnet-4-6", provider: "anthropic" };
  mocks.addEntity.mockReset();
  mocks.addEntity.mockResolvedValue({
    id: "x",
    name: "X",
    appId: 5,
    color: "#14b8a6",
    initial: "X",
  });
});

describe("the Temperament slider in the Add entity dialog", () => {
  it("starts on Default and shows the label for each stop", () => {
    renderDialog();
    expect(slider().value).toBe("2");
    expect(screen.getByTestId("add-entity-temperament-label").textContent).toBe(
      "Default",
    );
    const seen: string[] = [];
    for (const v of ["0", "1", "2", "3", "4"]) {
      fireEvent.change(slider(), { target: { value: v } });
      seen.push(
        screen.getByTestId("add-entity-temperament-label").textContent ?? "",
      );
    }
    expect(seen).toEqual([
      "Straight-laced",
      "Steady",
      "Default",
      "Playful",
      "Wild",
    ]);
  });

  it("sends the chosen temperature when creating the entity", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("add-entity-name"), {
      target: { value: "Wildcard" },
    });
    fireEvent.change(slider(), { target: { value: "4" } });
    fireEvent.click(screen.getByTestId("add-entity-create"));
    await waitFor(() => expect(mocks.addEntity).toHaveBeenCalledTimes(1));
    expect(mocks.addEntity.mock.calls[0][0]).toMatchObject({
      name: "Wildcard",
      temperature: 1.6,
    });
  });

  it("sends no temperature at all when it is left on Default", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("add-entity-name"), {
      target: { value: "Plain" },
    });
    fireEvent.click(screen.getByTestId("add-entity-create"));
    await waitFor(() => expect(mocks.addEntity).toHaveBeenCalledTimes(1));
    expect(mocks.addEntity.mock.calls[0][0]).not.toHaveProperty("temperature");
  });

  it("shows no note on a model that takes a custom temperature", () => {
    renderDialog();
    expect(screen.queryByTestId("add-entity-temperament-note")).toBeNull();
  });

  it.each([
    [{ name: "gpt-5", provider: "openai" }],
    [{ name: "auto", provider: "auto", connection: "subscription" }],
    [{ name: "sonnet", provider: "claude-code" }],
  ])("says the model ignores temperament: %j", (model) => {
    mocks.selectedModel = model;
    renderDialog();
    const note = screen.getByTestId("add-entity-temperament-note");
    expect(note.textContent).toContain(model.name);
    expect(note.textContent).toContain("ignores temperament");
  });
});
