import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown> | null,
  updateSettings: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: h.settings,
    updateSettings: h.updateSettings,
  }),
}));

import { StartMinimizedSwitch } from "./StartMinimizedSwitch";

describe("StartMinimizedSwitch", () => {
  beforeEach(() => {
    h.updateSettings.mockClear();
    h.settings = {};
  });

  it("is on when the setting was never saved", () => {
    render(<StartMinimizedSwitch />);
    const toggle = screen.getByRole("switch", { name: "Open minimized" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("is off only when it was turned off", () => {
    h.settings = { startMinimized: false };
    render(<StartMinimizedSwitch />);
    expect(
      screen
        .getByRole("switch", { name: "Open minimized" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("saves the new value when toggled", () => {
    render(<StartMinimizedSwitch />);
    fireEvent.click(screen.getByRole("switch", { name: "Open minimized" }));
    expect(h.updateSettings).toHaveBeenCalledWith({ startMinimized: false });
  });

  it("renders nothing until settings load", () => {
    h.settings = null;
    const { container } = render(<StartMinimizedSwitch />);
    expect(container.innerHTML).toBe("");
  });
});
