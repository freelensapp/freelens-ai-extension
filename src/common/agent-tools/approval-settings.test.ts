import { describe, expect, it } from "vitest";
import { loadApprovalOverrides, requiresApproval, withApprovalOverride } from "./approval-settings";
import { getClusterVersionTool, getPodLogsTool, restartKubernetesResourceTool } from "./index";

describe("approval settings", () => {
  it("falls back to each tool's default when it has no override", () => {
    expect(requiresApproval(restartKubernetesResourceTool, {})).toBe(true);
    expect(requiresApproval(getClusterVersionTool, {})).toBe(false);
    expect(requiresApproval(restartKubernetesResourceTool, { restartKubernetesResource: false })).toBe(false);
    expect(requiresApproval(getClusterVersionTool, { getClusterVersion: true })).toBe(true);
  });

  it("stores only the tools whose choice differs from their default", () => {
    const off = withApprovalOverride({}, restartKubernetesResourceTool, false);
    expect(off).toEqual({ restartKubernetesResource: false });

    const both = withApprovalOverride(off, getClusterVersionTool, true);
    expect(both).toEqual({ restartKubernetesResource: false, getClusterVersion: true });

    expect(withApprovalOverride(both, restartKubernetesResourceTool, true)).toEqual({ getClusterVersion: true });
    expect(withApprovalOverride({}, getPodLogsTool, true)).toEqual({});
  });

  it("turns a saved podLogsRequireApproval: false into a getPodLogs override once", () => {
    expect(loadApprovalOverrides({ podLogsRequireApproval: false })).toEqual({ getPodLogs: false });
    expect(loadApprovalOverrides({ podLogsRequireApproval: true })).toEqual({});
    expect(loadApprovalOverrides({})).toEqual({});
  });

  it("ignores the old pod logs flag once overrides are saved", () => {
    expect(loadApprovalOverrides({ toolApprovalOverrides: {}, podLogsRequireApproval: false })).toEqual({});
    expect(
      loadApprovalOverrides({
        toolApprovalOverrides: { getPodLogs: true, broken: "yes" },
        podLogsRequireApproval: false,
      }),
    ).toEqual({ getPodLogs: true });
  });
});
