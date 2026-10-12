import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BuildItChip } from "./BuildItChip";

describe("BuildItChip", () => {
  it("builds only when tapped", () => {
    const onBuild = vi.fn();
    render(<BuildItChip onBuild={onBuild} />);

    expect(onBuild).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("build-it-chip"));
    expect(onBuild).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Build it")).toBeTruthy();
  });
});
