// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Interrupt, { type InterruptProps } from "./interrupt";

import type { CliApprovalRequest } from "../../../common/agent-protocol";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React reports a list child without a key on the console.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const cliApproval: CliApprovalRequest = {
  id: "k1",
  toolCallId: "t1",
  method: "confirm",
  program: "kubectl",
  args: ["delete", "pods", "web-1", "web-2", "-n", "web"],
  canonicalForms: [
    { program: "kubectl", verb: "delete", resource: "pods", name: "web-1", namespace: "web" },
    { program: "kubectl", verb: "delete", resource: "pods", name: "web-2", namespace: "web" },
  ],
  level: "ask",
  profileName: "Standard",
};

const props = (overrides: Partial<InterruptProps> = {}): InterruptProps => ({
  header: "kubectl delete pods web-1 web-2 -n web",
  question: "Do you want to approve this action?",
  cliApproval,
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

  it("marks a pending approval with an icon, its header text only the command line", () => {
    render(<Interrupt {...props()} />);

    const header = screen.getByText("kubectl delete pods web-1 web-2 -n web");
    expect(header.textContent).toBe("kubectl delete pods web-1 web-2 -n web");
    expect(header.querySelector("svg")).not.toBeNull();
  });

  it("shows no option buttons once the approval is resolved", () => {
    render(<Interrupt {...props({ approved: true })} />);

    expect(screen.queryByRole("button", { name: "yes" })).toBeNull();
    expect(screen.getByText("kubectl delete pods web-1 web-2 -n web")).toBeDefined();
  });
});

describe("Interrupt of a kubectl call", () => {
  const cliProps = (request: Partial<CliApprovalRequest> = {}) =>
    props({ cliApproval: { ...cliApproval, ...request } });

  it("shows the command line, every target, and the profile with its level", () => {
    render(<Interrupt {...cliProps()} />);

    expect(screen.getByText("kubectl delete pods web-1 web-2 -n web")).toBeDefined();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "kubectl delete pods web-1 -n web",
      "kubectl delete pods web-2 -n web",
    ]);
    expect(screen.getByText("Ask: the policy profile Standard asks before this invocation.")).toBeDefined();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("says that an Always ask call asks every time", () => {
    render(<Interrupt {...cliProps({ level: "alwaysAsk" })} />);

    expect(
      screen.getByText(
        'Always ask: the policy profile Standard asks before this invocation every time, even with "Approve all in this chat".',
      ),
    ).toBeDefined();
  });

  it("says that the values of the Secrets of a reveal target go to the model", () => {
    render(
      <Interrupt
        {...cliProps({
          args: ["get", "secrets", "db", "-n", "web", "-o", "yaml"],
          canonicalForms: [{ program: "kubectl", verb: "reveal", resource: "secrets", name: "db", namespace: "web" }],
        })}
      />,
    );

    expect(screen.getByText("Reveal: the values of these Secrets will be sent to the model unredacted.")).toBeDefined();
  });

  it("says nothing of a reveal for a call without one", () => {
    render(<Interrupt {...cliProps()} />);

    expect(screen.queryByText(/^Reveal:/)).toBeNull();
  });

  it("shows the manifest the call sends", () => {
    const manifest = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings\n";
    render(<Interrupt {...cliProps({ args: ["apply"], manifest })} />);

    expect(screen.getByText("Manifest")).toBeDefined();
    expect(screen.getByText(/kind: ConfigMap/)).toBeDefined();
  });

  it("shows no manifest for a call without one", () => {
    render(<Interrupt {...cliProps()} />);

    expect(screen.queryByText("Manifest")).toBeNull();
  });

  const scaleWeb = {
    program: "kubectl",
    verb: "scale",
    resource: "deployments",
    name: "web",
    namespace: "default",
  } as const;
  const replicasDiff = "--- current\n+++ dry run\n@@ -1,2 +1,2 @@\n spec:\n-  replicas: 2\n+  replicas: 3\n";

  it("shows the dry run's diff of each target, and says when a target does not change", () => {
    render(
      <Interrupt
        {...cliProps({
          canonicalForms: [scaleWeb, { ...scaleWeb, name: "api" }],
          preview: {
            kind: "diffs",
            diffs: [
              { target: scaleWeb, diff: replicasDiff },
              { target: { ...scaleWeb, name: "api" }, diff: "" },
            ],
          },
        })}
      />,
    );

    expect(screen.getByText("What the dry run changes")).toBeDefined();
    expect(screen.getAllByTestId("monaco-editor").map((editor) => editor.textContent)).toEqual([
      replicasDiff.replace(/\n$/, ""),
    ]);
    expect(screen.getAllByText("kubectl scale deployments web -n default")).toHaveLength(2);
    expect(screen.getByText("kubectl scale deployments api -n default: no change")).toBeDefined();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("says that the preview is unavailable, with the reason and the current YAML", () => {
    const backup = "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n";
    render(
      <Interrupt
        {...cliProps({
          preview: { kind: "unavailable", reason: "the dry run did not end within its timeout of 30 s", backup },
        })}
      />,
    );

    expect(screen.getByText("Preview unavailable: the dry run did not end within its timeout of 30 s")).toBeDefined();
    expect(screen.getByText("Current YAML")).toBeDefined();
    fireEvent.click(screen.getByText("Current YAML"));
    expect(screen.getByTestId("monaco-editor").textContent).toBe(backup.replace(/\n$/, ""));
  });

  it("shows no current YAML when the preview has no backup", () => {
    render(
      <Interrupt
        {...cliProps({ preview: { kind: "unavailable", reason: "kubectl cordon prints no object in a dry run" } })}
      />,
    );

    expect(screen.getByText("Preview unavailable: kubectl cordon prints no object in a dry run")).toBeDefined();
    expect(screen.queryByText("Current YAML")).toBeNull();
  });

  it("shows no preview for a verb without a dry run", () => {
    render(<Interrupt {...cliProps()} />);

    expect(screen.queryByText("What the dry run changes")).toBeNull();
    expect(screen.queryByText(/^Preview unavailable/)).toBeNull();
  });
});
