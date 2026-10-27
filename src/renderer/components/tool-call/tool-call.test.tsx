// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolCall } from "./tool-call";

import type { ToolCallView } from "../../../common/objects/message-object";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React reports a prop the DOM does not take on the console.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const call = (overrides: Partial<ToolCallView> = {}): ToolCallView => ({
  toolCallId: "t1",
  toolName: "getKubernetesResource",
  args: { kind: "Pod", name: "web-1" },
  running: false,
  result: "kind: Pod",
  isError: false,
  ...overrides,
});

const summary = () => document.querySelector("summary")?.textContent;

describe("ToolCall", () => {
  it("shows the tool's name and arguments on one line, with the result folded under it", () => {
    render(<ToolCall toolCall={call()} />);

    expect(summary()).toBe('getKubernetesResource{"kind":"Pod","name":"web-1"}');
    expect(document.querySelector("details")?.open).toBe(false);
    expect(screen.getByText("kind: Pod")).toBeTruthy();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("marks a call that is still running", () => {
    render(<ToolCall toolCall={call({ running: true, result: undefined, isError: undefined })} />);

    expect(summary()).toContain("running");
  });

  it("marks a failed call and shows its error", () => {
    render(<ToolCall toolCall={call({ result: "Cluster not connected", isError: true })} />);

    expect(summary()).toContain("failed");
    expect(screen.getByText("Cluster not connected")).toBeTruthy();
  });

  it("marks a call the run ended before", () => {
    render(<ToolCall toolCall={call({ result: undefined, isError: undefined })} />);

    expect(summary()).toContain("not run");
  });
});
