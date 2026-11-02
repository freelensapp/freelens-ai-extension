import { describe, expect, it } from "vitest";
import { STANDARD_PROFILE } from "../invocation-policy/shipped-profiles";
import { migrateApprovalChoices } from "./approval-migration";

import type { PolicyRule } from "../invocation-policy/policy-profile";

const allow = (...patterns: string[]): PolicyRule[] => patterns.map((pattern) => ({ pattern, level: "allow" }));
const ask = (...patterns: string[]): PolicyRule[] => patterns.map((pattern) => ({ pattern, level: "ask" }));

describe("migrateApprovalChoices", () => {
  it.each<[string, object]>([
    ["a store without the old fields", {}],
    ["no overrides saved", { toolApprovalOverrides: {} }],
    ["the old pod logs flag left on", { podLogsRequireApproval: true }],
    ["choices equal to the defaults", { toolApprovalOverrides: { getPodLogs: true, getClusterVersion: false } }],
    ["fields already cleared", { toolApprovalOverrides: null, podLogsRequireApproval: null }],
    ["unknown tools and values that are not choices", { toolApprovalOverrides: { kubectl: true, deletePod: "no" } }],
  ])("creates no profile for %s", (_case, saved) => {
    expect(migrateApprovalChoices(saved)).toBeUndefined();
  });

  it("copies Standard as the profile Standard (migrated), with pod logs allowed for an old podLogsRequireApproval: false", () => {
    expect(migrateApprovalChoices({ podLogsRequireApproval: false })).toEqual({
      id: "standard-migrated",
      name: "Standard (migrated)",
      rules: STANDARD_PROFILE.rules.map((rule) =>
        rule.pattern === "kubectl logs *" ? { pattern: "kubectl logs *", level: "allow" } : rule,
      ),
      fallbackLevel: "ask",
    });
  });

  it("ignores the old pod logs flag once overrides are saved", () => {
    expect(migrateApprovalChoices({ toolApprovalOverrides: {}, podLogsRequireApproval: false })).toBeUndefined();
  });

  it.each<[string, PolicyRule[]]>([
    ["patchKubernetesResource", allow("kubectl patch *", "kubectl scale *", "kubectl set *")],
    ["updateKubernetesResource", allow("kubectl replace *", "kubectl apply *")],
    ["createKubernetesResource", allow("kubectl create *", "kubectl apply *")],
    ["deleteKubernetesResource", allow("kubectl delete *")],
    ["deletePod", allow("kubectl delete pods *")],
    ["restartKubernetesResource", allow("kubectl rollout restart *")],
  ])("allows the verbs of %s once its approval was turned off", (tool, rules) => {
    expect(migrateApprovalChoices({ toolApprovalOverrides: { [tool]: false } })?.rules).toEqual([
      ...STANDARD_PROFILE.rules,
      ...rules,
    ]);
  });

  it("asks before the reads of a read tool once its approval was turned on", () => {
    expect(migrateApprovalChoices({ toolApprovalOverrides: { getNamespaces: true } })?.rules).toEqual([
      ...STANDARD_PROFILE.rules,
      ...ask("kubectl get namespaces *"),
    ]);
  });

  it("replaces a rule of Standard that has the same pattern rather than adding a second one", () => {
    const rules = migrateApprovalChoices({
      toolApprovalOverrides: {
        getClusterVersion: true,
        getKubernetesResource: true,
        getWarningEventsByNamespace: true,
      },
    })?.rules;

    expect(
      rules?.filter((rule) => ["kubectl version", "kubectl get *", "kubectl events *"].includes(rule.pattern)),
    ).toEqual(ask("kubectl get *", "kubectl events *", "kubectl version"));
    expect(rules).toHaveLength(STANDARD_PROFILE.rules.length + 1);
  });

  it("adds a verb two tools share once", () => {
    const rules = migrateApprovalChoices({
      toolApprovalOverrides: { createKubernetesResource: false, updateKubernetesResource: false },
    })?.rules;

    expect(rules?.slice(STANDARD_PROFILE.rules.length)).toEqual(
      allow("kubectl create *", "kubectl apply *", "kubectl replace *"),
    );
  });
});
