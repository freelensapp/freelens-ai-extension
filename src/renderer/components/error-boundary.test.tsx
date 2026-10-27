// @vitest-environment jsdom

import { Common, type Renderer } from "@freelensapp/extensions";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorBoundary,
  withMenuItemErrorBoundary,
  withPageErrorBoundary,
  withPreferenceErrorBoundary,
} from "./error-boundary";

// A minimal stub extension - only `name` is read by the boundary.
const extension = { name: "@freelensapp/ai-extension" } as Renderer.LensExtension;

beforeEach(() => {
  // React reports an error that a boundary caught on the console as well.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const Throws = ({ message = "boom" }: { message?: string }): React.JSX.Element => {
  throw new Error(message);
};

// A child that throws only for some objects, as a menu item does for an object without a field it reads.
const ThrowsFor = ({ object }: { object: { broken: boolean } }) => {
  if (object.broken) throw new Error("broken object");
  return <p>fine object</p>;
};

describe("ErrorBoundary", () => {
  it("renders the error page in place of a child that throws, logs it, and leaves its siblings rendered", () => {
    render(
      <>
        <p>before</p>
        <ErrorBoundary extension={extension}>
          <p>inside</p>
          <Throws />
        </ErrorBoundary>
        <p>after</p>
      </>,
    );

    expect(screen.getByText("Error: boom")).toBeDefined();
    expect(screen.queryByText("inside")).toBeNull();
    expect(screen.getByText("before")).toBeDefined();
    expect(screen.getByText("after")).toBeDefined();
    expect(Common.logger.error).toHaveBeenCalledTimes(1);
    expect(Common.logger.error).toHaveBeenCalledWith("[@freelensapp/ai-extension]: Error: boom", expect.any(String));
  });

  it("renders nothing in place of a child that throws with the fallback nothing, and logs it", () => {
    render(
      <ul>
        <li>Edit</li>
        <ErrorBoundary extension={extension} fallback="nothing">
          <li>Explain</li>
          <Throws message="menu item" />
        </ErrorBoundary>
        <li>Delete</li>
      </ul>,
    );

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Edit", "Delete"]);
    expect(Common.logger.error).toHaveBeenCalledWith(
      "[@freelensapp/ai-extension]: Error: menu item",
      expect.any(String),
    );
  });

  it("renders its children without an error", () => {
    render(
      <ErrorBoundary extension={extension}>
        <p>inside</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText("inside")).toBeDefined();
    expect(Common.logger.error).not.toHaveBeenCalled();
  });

  it("renders the children again for a new reset key", () => {
    const broken = { broken: true };
    const fixed = { broken: false };
    const { rerender } = render(
      <ErrorBoundary extension={extension} resetKey={broken}>
        <ThrowsFor object={broken} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Error: broken object")).toBeDefined();

    rerender(
      <ErrorBoundary extension={extension} resetKey={fixed}>
        <ThrowsFor object={fixed} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("fine object")).toBeDefined();
    expect(screen.queryByText("Error: broken object")).toBeNull();
  });
});

describe("the registration wrappers", () => {
  it("keep an error of a page inside the page", () => {
    const { Page } = withPageErrorBoundary(extension, {
      id: "broken",
      components: { Page: () => <Throws /> },
    }).components;

    render(
      <>
        <Page params={{}} />
        <p>sidebar</p>
      </>,
    );

    expect(screen.getByText("Error: boom")).toBeDefined();
    expect(screen.getByText("sidebar")).toBeDefined();
  });

  it("render nothing for a menu item that throws, leave the other items rendered, and render it again for a new object", () => {
    const { MenuItem } = withMenuItemErrorBoundary(extension, {
      kind: "Event",
      apiVersions: ["v1"],
      components: { MenuItem: ({ object }) => <li>{object.broken ? <Throws message="menu item" /> : "Explain"}</li> },
    }).components;

    const { rerender } = render(
      <ul>
        <li>Edit</li>
        <MenuItem object={{ broken: true }} />
        <li>Delete</li>
      </ul>,
    );

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Edit", "Delete"]);
    expect(Common.logger.error).toHaveBeenCalledWith(
      "[@freelensapp/ai-extension]: Error: menu item",
      expect.any(String),
    );

    rerender(
      <ul>
        <li>Edit</li>
        <MenuItem object={{ broken: false }} />
        <li>Delete</li>
      </ul>,
    );

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Edit", "Explain", "Delete"]);
  });

  it("keep an error of the preferences inside this extension's preferences", () => {
    const { Input, Hint } = withPreferenceErrorBoundary(extension, {
      title: "Freelens AI Settings",
      components: { Input: () => <Throws message="preferences" />, Hint: () => <Throws message="hint" /> },
    }).components;

    render(
      <>
        <Input />
        <Hint />
        <p>other extension</p>
      </>,
    );

    expect(screen.getByText("Error: preferences")).toBeDefined();
    expect(screen.queryByText("Error: hint")).toBeNull();
    expect(screen.getByText("other extension")).toBeDefined();
    expect(Common.logger.error).toHaveBeenCalledWith(
      "[@freelensapp/ai-extension]: Error: preferences",
      expect.any(String),
    );
    expect(Common.logger.error).toHaveBeenCalledWith("[@freelensapp/ai-extension]: Error: hint", expect.any(String));
  });

  it("render the preferences as they are without an error", () => {
    const { Input, Hint } = withPreferenceErrorBoundary(extension, {
      title: "Freelens AI Settings",
      components: { Input: () => <p>settings</p>, Hint: () => <span>hint</span> },
    }).components;

    render(
      <>
        <Input />
        <Hint />
      </>,
    );

    expect(screen.getByText("settings")).toBeDefined();
    expect(screen.getByText("hint")).toBeDefined();
    expect(Common.logger.error).not.toHaveBeenCalled();
  });
});
