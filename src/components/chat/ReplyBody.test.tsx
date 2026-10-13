import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./DyadMarkdownParser", () => ({
  DyadMarkdownParser: ({
    content,
    showStreamingPreview,
  }: {
    content: string;
    showStreamingPreview?: boolean;
  }) => (
    <div data-testid="markdown" data-preview={String(!!showStreamingPreview)}>
      {content}
    </div>
  ),
}));
vi.mock("./StreamingLoadingAnimation", () => ({
  StreamingLoadingAnimation: ({ variant }: { variant: string }) => (
    <div data-testid={`loading-${variant}`} />
  ),
}));

import { ReplyBody } from "./ReplyBody";

const READ = '<dyad-read path="src/a.ts"></dyad-read>';
const FINISHED = `Let me read it. ${READ}All done. The page works now.`;

function renderBody(
  overrides: Partial<React.ComponentProps<typeof ReplyBody>> = {},
) {
  return render(
    <ReplyBody
      content={FINISHED}
      messageId={1}
      summaryView={true}
      isLastMessage={true}
      isStreaming={false}
      {...overrides}
    />,
  );
}

describe("ReplyBody", () => {
  afterEach(cleanup);

  it("folds her working and shows only the final message", () => {
    const { container } = renderBody();

    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details!.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Show work (1 step)")).toBeTruthy();
    expect(details!.textContent).toContain("Let me read it.");
    expect(details!.textContent).not.toContain("All done.");

    const outside = screen
      .getAllByTestId("markdown")
      .filter((node) => !details!.contains(node));
    expect(outside).toHaveLength(1);
    expect(outside[0].textContent).toBe("All done. The page works now.");
  });

  it("shows everything when Summary view is off", () => {
    const { container } = renderBody({ summaryView: false });

    expect(container.querySelector("details")).toBeNull();
    expect(screen.getAllByTestId("markdown")).toHaveLength(1);
    expect(screen.getByTestId("markdown").textContent).toBe(FINISHED);
  });

  it("shows only the working indicator while she is working", () => {
    renderBody({
      content: `Let me look. ${READ}`,
      isStreaming: true,
    });

    expect(screen.queryByTestId("markdown")).toBeNull();
    expect(screen.getByTestId("loading-streaming")).toBeTruthy();
  });

  it("shows a streaming plain answer as it arrives", () => {
    renderBody({ content: "Here is part of an answer", isStreaming: true });

    expect(screen.getByTestId("markdown").textContent).toBe(
      "Here is part of an answer",
    );
    expect(screen.getByTestId("markdown").dataset.preview).toBe("true");
    expect(screen.getByTestId("loading-streaming")).toBeTruthy();
  });

  it("does not hide a reply that needs your attention while streaming", () => {
    const content = `${READ}<dyad-questionnaire title="Pick one"></dyad-questionnaire>`;
    renderBody({ content, isStreaming: true });

    expect(screen.getByTestId("markdown").textContent).toBe(content);
  });

  it("does not fold older messages differently from the last one", () => {
    const { container } = renderBody({
      isLastMessage: false,
      isStreaming: true,
    });

    expect(container.querySelector("details")).not.toBeNull();
    expect(screen.queryByTestId("loading-streaming")).toBeNull();
  });
});
