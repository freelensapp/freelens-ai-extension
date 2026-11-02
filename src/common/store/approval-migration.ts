// The one-time move of the old per-tool "Requires approval" choices into a
// user profile. Kept free of host and MobX imports so it is unit-tested alone,
// and free of the old tool definitions, which go away: the defaults and the
// verbs of each old tool are written down here.

import { STANDARD_PROFILE } from "../invocation-policy/shipped-profiles";

import type { PolicyProfile, PolicyRule } from "../invocation-policy/policy-profile";

/** The id of the user profile the old choices become. */
export const MIGRATED_PROFILE_ID = "standard-migrated";

interface OldToolApproval {
  requiresApprovalByDefault: boolean;
  /** The patterns of the CLI invocations that do what the tool did. */
  patterns: readonly string[];
}

const OLD_TOOL_APPROVALS: Readonly<Record<string, OldToolApproval>> = {
  getClusterVersion: { requiresApprovalByDefault: false, patterns: ["kubectl version"] },
  getNamespaces: { requiresApprovalByDefault: false, patterns: ["kubectl get namespaces *"] },
  getWarningEventsByNamespace: {
    requiresApprovalByDefault: false,
    patterns: ["kubectl get events *", "kubectl events *"],
  },
  listKubernetesResources: { requiresApprovalByDefault: false, patterns: ["kubectl get *"] },
  getKubernetesResource: { requiresApprovalByDefault: false, patterns: ["kubectl get *"] },
  getPodLogs: { requiresApprovalByDefault: true, patterns: ["kubectl logs *"] },
  createKubernetesResource: { requiresApprovalByDefault: true, patterns: ["kubectl create *", "kubectl apply *"] },
  updateKubernetesResource: { requiresApprovalByDefault: true, patterns: ["kubectl replace *", "kubectl apply *"] },
  patchKubernetesResource: {
    requiresApprovalByDefault: true,
    patterns: ["kubectl patch *", "kubectl scale *", "kubectl set *"],
  },
  deleteKubernetesResource: { requiresApprovalByDefault: true, patterns: ["kubectl delete *"] },
  deletePod: { requiresApprovalByDefault: true, patterns: ["kubectl delete pods *"] },
  restartKubernetesResource: { requiresApprovalByDefault: true, patterns: ["kubectl rollout restart *"] },
};

export interface SavedApprovalChoices {
  /** The choices by tool name, only those that differed from the tool's default. */
  toolApprovalOverrides?: unknown;
  /** The pod logs switch before per-tool choices; read only while no overrides are saved. */
  podLogsRequireApproval?: unknown;
}

// The saved choices, as the old preferences read them.
const savedChoices = (saved: SavedApprovalChoices): Record<string, unknown> => {
  const overrides = saved.toolApprovalOverrides;
  if (typeof overrides === "object" && overrides !== null && !Array.isArray(overrides)) {
    return overrides as Record<string, unknown>;
  }
  return saved.podLogsRequireApproval === false ? { getPodLogs: false } : {};
};

/**
 * The user profile "Standard (migrated)" for old choices that differ from the
 * tools' defaults, or undefined without such choices. It is Standard with the
 * choices as rules: a tool whose approval was turned off allows its verbs, a
 * read tool whose approval was turned on asks before its reads. A rule
 * replaces the rule of Standard with the same pattern.
 */
export function migrateApprovalChoices(saved: SavedApprovalChoices): PolicyProfile | undefined {
  const translated = new Map<string, PolicyRule>();
  for (const [tool, choice] of Object.entries(savedChoices(saved))) {
    const old = OLD_TOOL_APPROVALS[tool];
    if (!old || typeof choice !== "boolean" || choice === old.requiresApprovalByDefault) continue;
    for (const pattern of old.patterns) {
      translated.set(pattern, { pattern, level: choice ? "ask" : "allow" });
    }
  }
  if (translated.size === 0) return undefined;

  const rules = STANDARD_PROFILE.rules.map((rule) => translated.get(rule.pattern) ?? rule);
  const standardPatterns = new Set(STANDARD_PROFILE.rules.map((rule) => rule.pattern));
  for (const rule of translated.values()) {
    if (!standardPatterns.has(rule.pattern)) rules.push(rule);
  }
  return {
    id: MIGRATED_PROFILE_ID,
    name: "Standard (migrated)",
    rules,
    fallbackLevel: STANDARD_PROFILE.fallbackLevel,
  };
}
