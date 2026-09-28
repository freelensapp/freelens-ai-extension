import { describe, expect, it, vi } from "vitest";
import {
  APPROVAL_INTERRUPT_NAME,
  buildApprovalRequest,
  buildMcpApprovalRequest,
  isApprovalRequest,
  requestApproval,
  toInterruptReason,
} from "./approval";

describe("buildApprovalRequest", () => {
  it("renders the action payload as YAML with a markdown fallback", () => {
    const request = buildApprovalRequest("DELETE POD", { name: "web", namespace: "default" });
    expect(request.question).toBe("Do you want to approve this action?");
    expect(request.options).toEqual(["yes", "no"]);
    expect(request.actionToApprove).toEqual({ action: "DELETE POD", name: "web", namespace: "default" });
    expect(request.actionString).toBe("action: DELETE POD\nname: web\nnamespace: default\n");
    expect(request.requestString).toBe("```yaml\naction: DELETE POD\nname: web\nnamespace: default\n```");
    expect(request.resourcesString).toBeUndefined();
  });

  it("carries the backup of the resources that will be changed", () => {
    const request = buildApprovalRequest("PATCH DEPLOYMENT", { name: "web" }, "kind: Deployment\n");
    expect(request.resourcesString).toBe("kind: Deployment\n");
  });
});

describe("buildMcpApprovalRequest", () => {
  it("names the requested MCP tool", () => {
    const request = buildMcpApprovalRequest("search");
    expect(request.actionToApprove).toEqual({ action: ["search"] });
    expect(request.requestString).toBe("The agent wants to use this tool: search");
    expect(request.actionString).toBeUndefined();
  });
});

describe("toInterruptReason", () => {
  it("drops undefined fields so the reason is a JSON value", () => {
    const reason = toInterruptReason(buildApprovalRequest("CREATE POD", { name: "web", namespace: undefined }));
    expect(reason).not.toHaveProperty("resourcesString");
    expect((reason as { actionToApprove: object }).actionToApprove).toEqual({ action: "CREATE POD", name: "web" });
  });
});

describe("isApprovalRequest", () => {
  it("accepts approval payloads only", () => {
    expect(isApprovalRequest(buildMcpApprovalRequest("search"))).toBe(true);
    expect(isApprovalRequest({ question: "q" })).toBe(false);
    expect(isApprovalRequest("yes")).toBe(false);
  });
});

describe("requestApproval", () => {
  it("approves only on a yes answer", () => {
    const approve = { interrupt: vi.fn().mockReturnValue("yes") };
    const deny = { interrupt: vi.fn().mockReturnValue("no") };
    expect(requestApproval(approve, "DELETE POD", { name: "web" })).toBe(true);
    expect(requestApproval(deny, "DELETE POD", { name: "web" })).toBe(false);
  });

  it("raises a named interrupt carrying the approval payload", () => {
    const context = { interrupt: vi.fn().mockReturnValue("yes") };
    requestApproval(context, "RESTART DEPLOYMENT", { name: "web" }, "kind: Deployment\n");
    expect(context.interrupt).toHaveBeenCalledWith({
      name: APPROVAL_INTERRUPT_NAME,
      reason: expect.objectContaining({
        actionToApprove: { action: "RESTART DEPLOYMENT", name: "web" },
        resourcesString: "kind: Deployment\n",
      }),
    });
  });

  it("denies when there is no interruptible context", () => {
    expect(requestApproval(undefined, "DELETE POD", { name: "web" })).toBe(false);
  });
});
