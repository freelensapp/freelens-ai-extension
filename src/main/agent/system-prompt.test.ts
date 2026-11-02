import { describe, expect, it } from "vitest";
import { EXPLAIN_PROMPT, SYSTEM_PROMPT } from "./system-prompt";

// Anything outside ASCII, which covers emoji and the symbol ranges they live in.
const NON_ASCII = /[^\x09\x0a\x0d\x20-\x7e]/;

describe("SYSTEM_PROMPT", () => {
  it("says that the agent runs kubectl through the tool, only within the floor and the profile", () => {
    expect(SYSTEM_PROMPT).toMatch(/<kubectl>[\s\S]*<\/kubectl>/);
    expect(SYSTEM_PROMPT).toMatch(/You run kubectl against this cluster through the kubectl tool/);
    expect(SYSTEM_PROMPT).toMatch(
      /only within the floor and the policy profile that the <cli_policy> section describes/,
    );
  });

  it("tells the agent to keep the output small with grep, selectors and -o", () => {
    expect(SYSTEM_PROMPT).toMatch(/Keep the output small/);
    expect(SYSTEM_PROMPT).toMatch(/a label selector \(-l\) or a field selector \(--field-selector\)/);
    expect(SYSTEM_PROMPT).toMatch(/choose what is printed with -o/);
    expect(SYSTEM_PROMPT).toMatch(/set the grep parameter/);
  });

  it("no longer says there is no shell, and drops the guidance of the old tools", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/no shell/i);
    expect(SYSTEM_PROMPT).not.toMatch(/cannot run kubectl/i);
    expect(SYSTEM_PROMPT).not.toMatch(/<log_reading>|<subresources>/);
    expect(SYSTEM_PROMPT).not.toMatch(/getPodLogs|"filter"|"resize"|force_finalize/);
    expect(SYSTEM_PROMPT).not.toMatch(/patch over update/);
  });

  it("states the safety rules for changes to the cluster", () => {
    expect(SYSTEM_PROMPT).toMatch(/<safety>[\s\S]*<\/safety>/);
    expect(SYSTEM_PROMPT).toMatch(/current state before changing it/);
    expect(SYSTEM_PROMPT).toMatch(/one change at a time/i);
    expect(SYSTEM_PROMPT).toMatch(/one line what will change/);
    expect(SYSTEM_PROMPT).toMatch(/least destructive/);
    expect(SYSTEM_PROMPT).toMatch(/namespaces, CustomResourceDefinitions or other cluster-scoped resources/);
  });

  it("drops the routing and coding-agent leftovers", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/coding task/i);
    expect(SYSTEM_PROMPT).not.toMatch(/supervisor|worker/i);
    expect(SYSTEM_PROMPT).not.toMatch(/more than one time/);
    expect(SYSTEM_PROMPT).not.toMatch(/NEVER refer to tool names/);
  });

  it("has no emoji", () => {
    expect(SYSTEM_PROMPT).not.toMatch(NON_ASCII);
    expect(EXPLAIN_PROMPT).not.toMatch(NON_ASCII);
  });
});
