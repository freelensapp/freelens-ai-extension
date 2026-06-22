import { describe, expect, it } from "vitest";
import { hasManagedFields, stripManagedFields } from "./managed-fields";

describe("hasManagedFields", () => {
  it("detects a managedFields block anywhere in the document", () => {
    const yaml = ["apiVersion: v1", "metadata:", "  name: demo", "  managedFields:", "    - manager: kubectl"].join(
      "\n",
    );
    expect(hasManagedFields(yaml)).toBe(true);
  });

  it("returns false when there is no managedFields block", () => {
    expect(hasManagedFields("metadata:\n  name: demo")).toBe(false);
  });

  it("ignores an inline empty managedFields value", () => {
    expect(hasManagedFields("metadata:\n  managedFields: []")).toBe(false);
  });
});

describe("stripManagedFields", () => {
  it("removes the managedFields block and keeps surrounding keys", () => {
    const yaml = [
      "apiVersion: v1",
      "kind: ConfigMap",
      "metadata:",
      "  name: demo",
      "  managedFields:",
      "    - manager: kubectl",
      "      operation: Update",
      "      fieldsV1:",
      "        f:data: {}",
      "  namespace: default",
      "data:",
      "  key: value",
    ].join("\n");

    expect(stripManagedFields(yaml)).toBe(
      [
        "apiVersion: v1",
        "kind: ConfigMap",
        "metadata:",
        "  name: demo",
        "  namespace: default",
        "data:",
        "  key: value",
      ].join("\n"),
    );
  });

  it("removes a trailing managedFields block at the end of the document", () => {
    const yaml = ["metadata:", "  name: demo", "  managedFields:", "    - manager: kubectl"].join("\n");
    expect(stripManagedFields(yaml)).toBe(["metadata:", "  name: demo"].join("\n"));
  });

  it("leaves documents without managedFields untouched", () => {
    const yaml = "metadata:\n  name: demo";
    expect(stripManagedFields(yaml)).toBe(yaml);
  });

  it("stops at a blank line within the block", () => {
    const yaml = ["metadata:", "  managedFields:", "    - manager: kubectl", "", "data:", "  key: value"].join("\n");
    expect(stripManagedFields(yaml)).toBe(["metadata:", "", "data:", "  key: value"].join("\n"));
  });
});
