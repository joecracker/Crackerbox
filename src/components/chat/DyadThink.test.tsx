import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DyadThink } from "./DyadThink";

describe("DyadThink", () => {
  it("keeps live reasoning compact until the user opens it", () => {
    render(
      <DyadThink node={{ properties: { state: "pending" } }}>
        {"Checking the drawings\nComparing every measurement"}
      </DyadThink>,
    );

    expect(screen.getByText("Thinking…")).toBeTruthy();
    expect(screen.getByText("Checking the drawings")).toBeTruthy();
    expect(screen.queryByText("Comparing every measurement")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Thinking/ }));

    expect(screen.getByText(/Comparing every measurement/)).toBeTruthy();
  });
});
