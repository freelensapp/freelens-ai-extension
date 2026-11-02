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

describe("ToolCall of a kubectl call", () => {
  const kubectlCall = (overrides: Partial<ToolCallView> = {}): ToolCallView =>
    call({
      toolName: "kubectl",
      args: { args: ["get", "pods", "-n", "flux-system"] },
      result: "Exit code: 0\n\nStandard output:\nsource-controller",
      invocation: { args: ["get", "pods", "-n", "flux-system"], exitCode: 0 },
      ...overrides,
    });
  const commandLine = () => document.querySelector("code")?.textContent;
  const folds = () =>
    [...document.querySelectorAll("details")].map((fold) => ({
      summary: fold.querySelector("summary")?.textContent,
      open: fold.open,
    }));

  it("shows the command line, with the output folded under its exit code", () => {
    render(<ToolCall toolCall={kubectlCall()} />);

    expect(commandLine()).toBe("kubectl get pods -n flux-system");
    expect(folds()).toEqual([{ summary: "Output, exit code 0", open: false }]);
    expect(screen.getByText(/source-controller/)).toBeTruthy();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("shows the arguments it ran with and folds the manifest it sent", () => {
    const manifest = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: settings";
    render(
      <ToolCall
        toolCall={kubectlCall({
          args: { args: ["apply"], manifest },
          result: "Exit code: 1\n\nStandard output: (empty)\n\nStandard error:\nerror: invalid object",
          isError: true,
          invocation: { args: ["apply", "-f", "-"], exitCode: 1 },
        })}
      />,
    );

    expect(commandLine()).toBe("kubectl apply -f -");
    expect(folds()).toEqual([
      { summary: "Manifest", open: false },
      { summary: "Output, exit code 1", open: false },
    ]);
    expect(document.querySelector("details pre")?.textContent).toBe(manifest);
    expect(screen.getByText("failed")).toBeTruthy();
  });

  it("quotes an argument a shell would split, so the line reads as what ran", () => {
    render(
      <ToolCall
        toolCall={kubectlCall({
          invocation: {
            args: ["get", "pods", "-l", "app in (web, db)", "-o", "jsonpath={.items[*].metadata.name}"],
            exitCode: 0,
          },
        })}
      />,
    );

    expect(commandLine()).toBe("kubectl get pods -l 'app in (web, db)' -o 'jsonpath={.items[*].metadata.name}'");
  });

  it("shows the progress of a running call, such as a kubectl download", () => {
    render(
      <ToolCall
        toolCall={kubectlCall({
          args: { args: ["version"] },
          running: true,
          progress: "Downloading kubectl: 50%",
          result: undefined,
          isError: undefined,
          invocation: undefined,
        })}
      />,
    );

    expect(commandLine()).toBe("kubectl version");
    expect(screen.getByText("Downloading kubectl: 50%")).toBeTruthy();
    expect(folds()).toEqual([]);
  });

  it.each([
    [
      "the floor entry",
      ["get", "pods", "--context", "prod"],
      "Blocked by the floor, which no policy profile lifts. Flags that change the cluster or the identity: --context is never allowed.",
    ],
    [
      "Deny of the profile",
      ["scale", "deployment", "web", "--replicas=3"],
      'Denied by the policy profile "Read only": kubectl scale deployments web -n default gets Deny from the profile\'s fallback level.',
    ],
    ["the user's denial", ["delete", "pod", "web-1"], "The user denied the action"],
  ])("shows the reason of a call that was blocked by %s under its command line", (_case, args, reason) => {
    render(
      <ToolCall toolCall={kubectlCall({ args: { args }, result: reason, isError: true, invocation: undefined })} />,
    );

    expect(commandLine()).toBe(`kubectl ${args.join(" ")}`);
    expect(screen.getByText("blocked")).toBeTruthy();
    expect(folds()).toEqual([]);
    expect(screen.getByText(reason)).toBeTruthy();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("says that a killed call has no exit code", () => {
    render(
      <ToolCall
        toolCall={kubectlCall({
          result: "kubectl was stopped before it ended.\n\nStandard output: (empty)",
          isError: true,
          invocation: { args: ["get", "pods", "-n", "flux-system"], exitCode: null },
        })}
      />,
    );

    expect(folds()).toEqual([{ summary: "Output, killed before it ended", open: false }]);
  });
});

describe("ToolCall of a helm call", () => {
  const helmCall = (overrides: Partial<ToolCallView> = {}): ToolCallView =>
    call({
      toolName: "helm",
      args: { args: ["history", "web", "-n", "apps"] },
      result: "Exit code: 0\n\nStandard output:\nREVISION\tSTATUS\n1\tdeployed",
      invocation: { args: ["history", "web", "-n", "apps"], exitCode: 0 },
      ...overrides,
    });
  const commandLine = () => document.querySelector("code")?.textContent;

  it("shows the command line, with the output folded under its exit code", () => {
    render(<ToolCall toolCall={helmCall()} />);

    expect(commandLine()).toBe("helm history web -n apps");
    expect(document.querySelector("details summary")?.textContent).toBe("Output, exit code 0");
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("shows the reason of a call the floor blocked under its command line", () => {
    const reason =
      "Blocked by the floor, which no policy profile lifts. The user's disk and local code: ./chart is a local chart path or a chart URL.";
    render(
      <ToolCall
        toolCall={helmCall({
          args: { args: ["upgrade", "web", "./chart", "--reuse-values"] },
          result: reason,
          isError: true,
          invocation: undefined,
        })}
      />,
    );

    expect(commandLine()).toBe("helm upgrade web ./chart --reuse-values");
    expect(screen.getByText("blocked")).toBeTruthy();
    expect(screen.getByText(reason)).toBeTruthy();
  });
});
