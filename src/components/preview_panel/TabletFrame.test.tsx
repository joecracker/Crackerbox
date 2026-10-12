import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TabletFrame } from "./TabletFrame";

describe("TabletFrame", () => {
  it("leaves the content alone when tablet mode is off", () => {
    render(
      <TabletFrame enabled={false} width={1280} height={800} scale={0.5}>
        <span>page</span>
      </TabletFrame>,
    );
    expect(screen.getByText("page")).toBeTruthy();
    expect(screen.queryByTestId("tablet-frame")).toBeNull();
  });

  it("takes the scaled-down space when tablet mode is on", () => {
    render(
      <TabletFrame enabled width={1280} height={800} scale={0.5}>
        <span>page</span>
      </TabletFrame>,
    );
    const frame = screen.getByTestId("tablet-frame");
    expect(frame.style.width).toBe("640px");
    expect(frame.style.height).toBe("400px");
    expect(frame.textContent).toBe("page");
  });
});
