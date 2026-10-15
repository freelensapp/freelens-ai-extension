import { describe, expect, it } from "vitest";
import { stripManagedFields } from "./project-resource";

describe("stripManagedFields", () => {
  it("removes managedFields by default", () => {
    const metadata = {
      name: "nginx",
      namespace: "default",
      managedFields: [{ manager: "kubectl", operation: "Update" }],
    };
    const result = stripManagedFields(metadata);
    expect(result).toEqual({ name: "nginx", namespace: "default" });
    expect(result).not.toHaveProperty("managedFields");
  });

  it("keeps managedFields when includeManagedFields is true", () => {
    const metadata = {
      name: "nginx",
      managedFields: [{ manager: "kubectl" }],
    };
    expect(stripManagedFields(metadata, true)).toEqual(metadata);
  });

  it("does not mutate the original metadata", () => {
    const metadata = {
      name: "nginx",
      managedFields: [{ manager: "kubectl" }],
    };
    stripManagedFields(metadata);
    expect(metadata).toHaveProperty("managedFields");
  });

  it("returns metadata unchanged when there is no managedFields", () => {
    const metadata = { name: "nginx", namespace: "default" };
    expect(stripManagedFields(metadata)).toEqual(metadata);
  });

  it("returns undefined metadata as-is", () => {
    expect(stripManagedFields(undefined)).toBeUndefined();
  });
});
