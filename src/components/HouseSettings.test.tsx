import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HouseSettings } from "./HouseSettings";

const mocks = vi.hoisted(() => ({
  listSisters: vi.fn(),
  listEntityAlways: vi.fn(),
  forgetEntityAlways: vi.fn(),
}));

vi.mock("@/hooks/usePocketVoices", () => ({
  usePocketVoices: () => ({ voices: [] }),
}));
vi.mock("@/ipc/types", () => ({
  ipc: {
    chat: {
      listSisters: mocks.listSisters,
      updateEntity: vi.fn(),
      listEntityAlways: mocks.listEntityAlways,
      forgetEntityAlways: mocks.forgetEntityAlways,
    },
  },
}));

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HouseSettings />
    </QueryClientProvider>,
  );
}

const entity = (id: string, name: string, askEveryStep?: boolean) => ({
  id,
  name,
  appId: 1,
  color: "#14b8a6",
  initial: name[0],
  askEveryStep,
});

beforeEach(() => {
  mocks.listSisters.mockReset();
  mocks.listEntityAlways.mockReset();
  mocks.forgetEntityAlways.mockReset();
});

describe("a helper's Always-allow rules in Settings > The house", () => {
  it("lists the helper's saved rules and nothing for other entities", async () => {
    mocks.listSisters.mockResolvedValue([
      entity("nyx", "Nyx"),
      entity("laptop", "Laptop", true),
    ]);
    mocks.listEntityAlways.mockResolvedValue(["run_command", "write_file"]);
    renderSettings();
    expect(await screen.findByText("run_command")).toBeTruthy();
    expect(screen.getByText("write_file")).toBeTruthy();
    expect(screen.queryByTestId("house-rules-nyx")).toBeNull();
    expect(mocks.listEntityAlways).toHaveBeenCalledTimes(1);
    expect(mocks.listEntityAlways).toHaveBeenCalledWith({ id: "laptop" });
  });

  it("Remove takes away only that tool and keeps the rest", async () => {
    mocks.listSisters.mockResolvedValue([entity("laptop", "Laptop", true)]);
    mocks.listEntityAlways.mockResolvedValue(["run_command", "write_file"]);
    mocks.forgetEntityAlways.mockResolvedValue(["write_file"]);
    renderSettings();
    await screen.findByText("run_command");
    fireEvent.click(
      screen.getByLabelText("Remove always allow for run_command"),
    );
    await waitFor(() => expect(screen.queryByText("run_command")).toBeNull());
    expect(screen.getByText("write_file")).toBeTruthy();
    expect(mocks.forgetEntityAlways).toHaveBeenCalledWith({
      id: "laptop",
      toolName: "run_command",
    });
  });

  it("shows nothing at all when the helper has no rules", async () => {
    mocks.listSisters.mockResolvedValue([entity("laptop", "Laptop", true)]);
    mocks.listEntityAlways.mockResolvedValue([]);
    renderSettings();
    await screen.findByTestId("house-entity-laptop");
    await waitFor(() => expect(mocks.listEntityAlways).toHaveBeenCalled());
    expect(screen.queryByTestId("house-rules-laptop")).toBeNull();
  });

  it("keeps the list closed until it is opened", async () => {
    mocks.listSisters.mockResolvedValue([entity("laptop", "Laptop", true)]);
    mocks.listEntityAlways.mockResolvedValue(["run_command"]);
    renderSettings();
    const box = (await screen.findByTestId(
      "house-rules-laptop",
    )) as HTMLDetailsElement;
    expect(box.open).toBe(false);
    expect(screen.getByText("Always-allowed tools (1)")).toBeTruthy();
  });
});
