// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownViewer } from "./markdown-viewer";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React reports an unknown or non-boolean DOM attribute on the console.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MarkdownViewer", () => {
  it("renders inline code as a code element with none of react-markdown's renderer props", () => {
    const { container } = render(<MarkdownViewer content="Run `kubectl get pods` now." />);

    const code = container.querySelector("code");
    expect(code?.textContent).toBe("kubectl get pods");
    expect(code?.getAttributeNames().sort()).toEqual(["class"]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("renders a fenced code block in the editor", () => {
    render(<MarkdownViewer content={"```yaml\nkind: Pod\n```"} />);

    expect(screen.getByTestId("monaco-editor").textContent).toBe("kind: Pod");
    expect(screen.getByText("yaml")).toBeDefined();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("renders a link that opens outside the app, without react-markdown's node", () => {
    render(<MarkdownViewer content="See [the docs](https://freelens.app/)." />);

    const link = screen.getByRole("link", { name: "the docs" });
    expect(link.getAttribute("href")).toBe("https://freelens.app/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.hasAttribute("node")).toBe(false);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
