// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIProviders, PROVIDER_LABELS } from "../../../common/provider/ai-models";
import { PreferencesStore } from "../../../common/store";
import { PreferencesPage } from "./preferences-page";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  PreferencesStore.resetInstance();
});

const store = () => PreferencesStore.getInstanceOrCreate<PreferencesStore>();

// The Select stand-ins in the order of the page: the reasoning effort, then the
// provider of a new model.
const selects = () => screen.getAllByTestId("select");

describe("PreferencesPage", () => {
  it("styles the text areas with its stylesheet, not inline", () => {
    render(<PreferencesPage />);

    const textareas = screen.getAllByRole("textbox").filter((element) => element.tagName === "TEXTAREA");
    expect(textareas).toHaveLength(2);
    for (const textarea of textareas) {
      expect(textarea.getAttribute("style")).toBeNull();
      expect(textarea.className).not.toBe("");
    }
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("sets the reasoning effort from the option picked, and back to the default when cleared", () => {
    render(<PreferencesPage />);

    fireEvent.click(within(selects()[0]).getByRole("button", { name: "High" }));
    expect(store().openAIReasoningEffort).toBe("high");

    fireEvent.click(within(selects()[0]).getByRole("button", { name: "Clear" }));
    expect(store().openAIReasoningEffort).toBe("");
  });

  it("adds a model of the provider picked, and keeps OpenAI when the provider is cleared", () => {
    render(<PreferencesPage />);

    fireEvent.click(within(selects()[1]).getByRole("button", { name: "Clear" }));
    fireEvent.change(screen.getByPlaceholderText("Model name, e.g. gpt-5.5"), { target: { value: " o4-mini " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(store().models.at(-1)).toEqual({ provider: AIProviders.OPEN_AI, name: "o4-mini" });
    expect(screen.getByText("o4-mini")).toBeDefined();
    expect(screen.getAllByText(PROVIDER_LABELS[AIProviders.OPEN_AI]).length).toBeGreaterThan(1);
  });

  it("falls back to another model when the selected one is removed", () => {
    const [first, second] = store().models;
    store().selectedModel = first.name;
    render(<PreferencesPage />);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove model" })[0]);

    expect(store().models.map((model) => model.name)).not.toContain(first.name);
    expect(store().selectedModel).toBe(second.name);
  });
});
