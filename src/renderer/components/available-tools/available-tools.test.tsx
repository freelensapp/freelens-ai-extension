// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvailableTools } from "./available-tools";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React reports a list child without a key on the console.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AvailableTools", () => {
  it("lists the kubectl and helm tools, each with the first sentence of its description", () => {
    render(<AvailableTools />);

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Kkubectl - Run one kubectl invocation against the cluster of this chat, through Freelens's connection to it.",
      "Hhelm - Run one helm invocation against the cluster of this chat, through Freelens's connection to it.",
    ]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
