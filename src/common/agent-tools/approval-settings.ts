import type { AgentToolDefinition } from "./index";

/**
 * The user's "Requires approval" choices, by tool name. Only tools whose choice
 * differs from their default are stored, so a new tool starts with its default.
 */
export type ToolApprovalOverrides = Readonly<Record<string, boolean>>;

/** Whether a call of `tool` waits for the user's approval. */
export const requiresApproval = (tool: AgentToolDefinition, overrides: ToolApprovalOverrides): boolean =>
  typeof overrides[tool.name] === "boolean" ? overrides[tool.name]! : tool.requiresApprovalByDefault;

/** The overrides with `tool` set to `value`; a value equal to the default drops the entry. */
export function withApprovalOverride(
  overrides: ToolApprovalOverrides,
  tool: AgentToolDefinition,
  value: boolean,
): ToolApprovalOverrides {
  const { [tool.name]: _previous, ...rest } = overrides;
  return value === tool.requiresApprovalByDefault ? rest : { ...rest, [tool.name]: value };
}

/**
 * The overrides as saved in the preferences. Before per-tool settings existed,
 * pod logs had their own `podLogsRequireApproval` flag; a saved `false` becomes
 * the `getPodLogs` override the first time, when no overrides are saved yet.
 */
export function loadApprovalOverrides(saved: {
  toolApprovalOverrides?: unknown;
  podLogsRequireApproval?: unknown;
}): ToolApprovalOverrides {
  const value = saved.toolApprovalOverrides;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === "boolean"));
  }
  return saved.podLogsRequireApproval === false ? { getPodLogs: false } : {};
}
