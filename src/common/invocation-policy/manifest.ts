import { parseAllDocuments } from "yaml";
import { type FloorRejection, rejectByFloor } from "./floor";

/** What a canonical form needs of one object of a manifest. */
export interface ManifestObject {
  apiVersion: string;
  kind: string;
  /** The object's name, or `*` for an object named by `metadata.generateName`. */
  name: string;
  namespace?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readObject = (value: unknown): ManifestObject | string => {
  if (!isRecord(value)) return "an item is not an object";
  const { apiVersion, kind, metadata } = value;
  if (typeof apiVersion !== "string" || typeof kind !== "string") return "an object has no apiVersion or kind";
  const meta = isRecord(metadata) ? metadata : {};
  const name = typeof meta.name === "string" ? meta.name : typeof meta.generateName === "string" ? "*" : undefined;
  if (name === undefined || name === "") return `the ${kind} object has no name`;
  const namespace = typeof meta.namespace === "string" && meta.namespace !== "" ? meta.namespace : undefined;
  return { apiVersion, kind, name, ...(namespace === undefined ? {} : { namespace }) };
};

/**
 * The objects of a manifest of one or more YAML or JSON documents; a `List`
 * (any kind ending in `List` with `items`) gives its items.
 */
export function readManifestObjects(manifest: string): ManifestObject[] | FloorRejection {
  const objects: ManifestObject[] = [];
  for (const document of parseAllDocuments(manifest)) {
    const error = document.errors[0];
    if (error) return rejectByFloor("manifest", `the manifest does not parse: ${error.message.split("\n")[0]}`);
    const value: unknown = document.toJS();
    if (value === null || value === undefined) continue;
    const items =
      isRecord(value) && typeof value.kind === "string" && value.kind.endsWith("List") && Array.isArray(value.items)
        ? value.items
        : [value];
    for (const item of items) {
      const object = readObject(item);
      if (typeof object === "string") return rejectByFloor("manifest", object);
      objects.push(object);
    }
  }
  if (objects.length === 0) return rejectByFloor("manifest", "the manifest has no object");
  return objects;
}
