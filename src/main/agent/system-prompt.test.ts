import { describe, expect, it } from "vitest";
import { EXPLAIN_PROMPT, SYSTEM_PROMPT } from "./system-prompt";

// Anything outside ASCII, which covers emoji and the symbol ranges they live in.
const NON_ASCII = /[^\x09\x0a\x0d\x20-\x7e]/;

describe("SYSTEM_PROMPT", () => {
  it("carries the log reading and subresource guidance", () => {
    expect(SYSTEM_PROMPT).toMatch(/<log_reading>[\s\S]*"filter"[\s\S]*<\/log_reading>/);
    expect(SYSTEM_PROMPT).toMatch(/<subresources>[\s\S]*"resize"[\s\S]*"scale"[\s\S]*<\/subresources>/);
  });

  it("states the safety rules for changes to the cluster", () => {
    expect(SYSTEM_PROMPT).toMatch(/<safety>[\s\S]*<\/safety>/);
    expect(SYSTEM_PROMPT).toMatch(/current state before changing it/);
    expect(SYSTEM_PROMPT).toMatch(/one change at a time/i);
    expect(SYSTEM_PROMPT).toMatch(/one line what will change/);
    expect(SYSTEM_PROMPT).toMatch(/least destructive/);
    expect(SYSTEM_PROMPT).toMatch(/force_finalize/);
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
