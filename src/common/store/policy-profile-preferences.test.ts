import { describe, expect, it } from "vitest";
import { loadDefaultProfileId, loadProfileAssignments, loadUserProfiles } from "./policy-profile-preferences";

const DEV = {
  id: "dev",
  name: "Development",
  rules: [{ pattern: "kubectl delete pods *", level: "allow" }],
  fallbackLevel: "ask",
};

describe("loadUserProfiles", () => {
  it("keeps the saved user profiles", () => {
    expect(loadUserProfiles([DEV])).toEqual([DEV]);
  });

  it.each<[string, unknown]>([
    ["nothing saved", undefined],
    ["not a list", { dev: DEV }],
  ])("is empty for %s", (_case, saved) => {
    expect(loadUserProfiles(saved)).toEqual([]);
  });

  it("leaves out a profile that is not whole, has the id of a shipped profile or of an earlier one", () => {
    expect(
      loadUserProfiles([
        DEV,
        { ...DEV, id: "standard" },
        { ...DEV, id: "dev", name: "Second" },
        { ...DEV, id: "no-name", name: 3 },
        { ...DEV, id: "bad-fallback", fallbackLevel: "maybe" },
        { ...DEV, id: "bad-rules", rules: "none" },
        null,
      ]),
    ).toEqual([DEV]);
  });

  it("leaves out a rule without a pattern or a level", () => {
    expect(
      loadUserProfiles([
        {
          ...DEV,
          rules: [{ pattern: "kubectl get *", level: "deny" }, { pattern: "kubectl logs *" }, { level: "allow" }, null],
        },
      ]),
    ).toEqual([{ ...DEV, rules: [{ pattern: "kubectl get *", level: "deny" }] }]);
  });
});

describe("loadProfileAssignments", () => {
  it("keeps the profile id of each cluster", () => {
    expect(loadProfileAssignments({ c1: "read-only", c2: "dev", c3: 4 })).toEqual({ c1: "read-only", c2: "dev" });
  });

  it.each([undefined, null, ["read-only"], "read-only"])("is empty for %j", (saved) => {
    expect(loadProfileAssignments(saved)).toEqual({});
  });
});

describe("loadDefaultProfileId", () => {
  it("keeps the saved id, and is Standard without one", () => {
    expect(loadDefaultProfileId("dev")).toBe("dev");
    expect(loadDefaultProfileId(undefined)).toBe("standard");
    expect(loadDefaultProfileId("")).toBe("standard");
  });
});
