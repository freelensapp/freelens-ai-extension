// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Interrupt, { type InterruptProps } from "./interrupt";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React reports a list child without a key on the console.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const props = (overrides: Partial<InterruptProps> = {}): InterruptProps => ({
  header: "patchKubernetesResource",
  question: "Do you want to approve this action?",
  text: "Patch the deployment web",
  actionDetails: "kind: Deployment\nname: web",
  resources: "kind: Deployment",
  options: ["yes", "no"],
  approved: null,
  onAction: vi.fn(),
  ...overrides,
});

describe("Interrupt", () => {
  it("renders the option buttons of a pending approval without a key warning", () => {
    render(<Interrupt {...props()} />);

    expect(screen.getAllByRole("button", { name: /^(yes|no)$/ }).map((button) => button.textContent)).toEqual([
      "yes",
      "no",
    ]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("answers with the option picked", () => {
    const onAction = vi.fn();
    render(<Interrupt {...props({ onAction })} />);

    fireEvent.click(screen.getByRole("button", { name: "no" }));

    expect(onAction).toHaveBeenCalledWith("no");
  });

  it("marks a pending approval with an icon, its header text only the action", () => {
    render(<Interrupt {...props()} />);

    const header = screen.getByText("patchKubernetesResource");
    expect(header.textContent).toBe("patchKubernetesResource");
    expect(header.querySelector("svg")).not.toBeNull();
  });

  it("shows no option buttons once the approval is resolved", () => {
    render(<Interrupt {...props({ approved: true })} />);

    expect(screen.queryByRole("button", { name: "yes" })).toBeNull();
    expect(screen.getByText("patchKubernetesResource")).toBeDefined();
  });
});
