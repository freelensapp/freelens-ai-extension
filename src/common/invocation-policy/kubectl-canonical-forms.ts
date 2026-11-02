import { type FloorRejection, rejectByFloor } from "./floor";
import { DEFAULT_SELECTORS } from "./kubectl-commands";
import { isFlagOn, type KubectlInvocation } from "./kubectl-invocation";
import {
  type CatalogResource,
  findCatalogKind,
  findCatalogResource,
  findCategoryResources,
  type ResourceCatalog,
} from "./resource-catalog";

import type { CanonicalForm } from "./canonical-form";
import type { ManifestObject } from "./manifest";

export interface KubectlFormsInput {
  invocation: KubectlInvocation;
  /** The objects of the manifest; absent without one. */
  manifestObjects?: readonly ManifestObject[];
  revealSecrets: boolean;
  catalog: ResourceCatalog;
  /** The namespace of a namespaced target without `-n`. */
  defaultNamespace: string;
}

/** A target before its namespace: a resource and a name, `*` for every object. */
interface Target {
  resource: CatalogResource;
  name: string;
  /** The namespace of a manifest object. */
  namespace?: string;
}

const commandLine = (invocation: KubectlInvocation): string => ["kubectl", ...invocation.command.path].join(" ");

const unplaceable = (invocation: KubectlInvocation, detail: string): FloorRejection =>
  rejectByFloor("unparseable", `${commandLine(invocation)} ${detail}`);

const unknownResource = (spelling: string): FloorRejection =>
  rejectByFloor("unknown-resource", `the resource catalog has no resource ${spelling}`);

/** The resources a spelling names: one resource, or the resources of a category such as `all`. */
const resolveResources = (catalog: ResourceCatalog, spelling: string): CatalogResource[] | FloorRejection => {
  const found = findCatalogResource(catalog, spelling);
  if (found) return [found];
  const category = findCategoryResources(catalog, spelling);
  return category.length > 0 ? category : unknownResource(spelling);
};

const resolveResource = (catalog: ResourceCatalog, spelling: string): CatalogResource | FloorRejection =>
  findCatalogResource(catalog, spelling) ?? unknownResource(spelling);

const isRejection = (value: unknown): value is FloorRejection =>
  typeof value === "object" && value !== null && "kind" in value && value.kind === "floor";

/** `TYPE/NAME`, split; undefined when the argument is not of that shape. */
const splitTypeName = (argument: string): [string, string] | undefined => {
  const parts = argument.split("/");
  return parts.length === 2 && parts[0] !== "" && parts[1] !== "" ? [parts[0] ?? "", parts[1] ?? ""] : undefined;
};

/** kubectl's resource arguments: `TYPE[,TYPE...] [NAME...]` or `TYPE/NAME...`. */
const resourceArgumentTargets = (
  input: KubectlFormsInput,
  resourceArguments: readonly string[],
  selected: boolean,
): Target[] | FloorRejection => {
  const { invocation, catalog } = input;
  const [first, ...rest] = resourceArguments;
  if (first === undefined) return unplaceable(invocation, "needs a resource or a manifest");

  if (first.includes("/")) {
    const targets: Target[] = [];
    for (const argument of resourceArguments) {
      const typeName = splitTypeName(argument);
      if (!typeName) return unplaceable(invocation, `cannot place ${argument}: give every target as TYPE/NAME`);
      const resource = resolveResource(catalog, typeName[0]);
      if (isRejection(resource)) return resource;
      targets.push({ resource, name: typeName[1] });
    }
    return targets;
  }

  const types = first.split(",");
  if (types.some((type) => type === "")) return unplaceable(invocation, `cannot place the resource list ${first}`);
  const misplaced = rest.find((name) => name.includes("/"));
  if (misplaced) return unplaceable(invocation, `cannot place ${misplaced} after the resource ${first}`);
  const names = selected || rest.length === 0 ? ["*"] : rest;
  const targets: Target[] = [];
  for (const type of types) {
    const resources = resolveResources(catalog, type);
    if (isRejection(resources)) return resources;
    for (const resource of resources) for (const name of names) targets.push({ resource, name });
  }
  return targets;
};

/** Whether the flags select every object of the target resources, which makes the name `*`. */
const selectsAll = (invocation: KubectlInvocation): boolean =>
  (invocation.command.selectors ?? DEFAULT_SELECTORS).some((selector) => isFlagOn(invocation, selector));

const operandTargets = (input: KubectlFormsInput): Target[] | FloorRejection | "verb-only" => {
  const { invocation, catalog } = input;
  const { operands, command } = invocation;
  const spec = command.operands;
  const tooMany = (max: number) =>
    operands.length > max ? unplaceable(invocation, `does not take the argument ${operands[max]}`) : undefined;

  switch (spec.kind) {
    case "none":
      return tooMany(0) ?? "verb-only";
    case "free":
      return tooMany(spec.max) ?? "verb-only";
    case "targets": {
      const trailing = spec.trailing ?? 0;
      if (operands.length <= trailing && trailing > 0) {
        return unplaceable(invocation, "needs a resource and its arguments");
      }
      const resourceArguments = operands
        .slice(0, operands.length - trailing)
        .filter((argument, position) => position === 0 || !spec.pairs?.(argument));
      return resourceArgumentTargets(input, resourceArguments, selectsAll(invocation));
    }
    case "workload": {
      const [first, ...extra] = operands;
      if (extra.length > spec.extra) return unplaceable(invocation, `does not take the argument ${extra[spec.extra]}`);
      if (first === undefined) {
        if (!isFlagOn(invocation, "--selector")) return unplaceable(invocation, "needs a pod, TYPE/NAME or -l");
        const resource = resolveResource(catalog, spec.resource);
        return isRejection(resource) ? resource : [{ resource, name: "*" }];
      }
      const typeName = first.includes("/") ? splitTypeName(first) : [spec.resource, first];
      if (!typeName) return unplaceable(invocation, `cannot place ${first}`);
      const resource = resolveResource(catalog, typeName[0]);
      return isRejection(resource) ? resource : [{ resource, name: typeName[1] }];
    }
    case "names": {
      const rejection = spec.max === undefined ? undefined : tooMany(spec.max);
      if (rejection) return rejection;
      const misplaced = operands.find((name) => name.includes("/"));
      if (misplaced) return unplaceable(invocation, `cannot place ${misplaced}: give the names alone`);
      const resource = resolveResource(catalog, spec.resource);
      if (isRejection(resource)) return resource;
      const names = selectsAll(invocation) || operands.length === 0 ? ["*"] : operands;
      return names.map((name) => ({ resource, name }));
    }
    case "name": {
      const [name] = operands;
      if (name === undefined) return unplaceable(invocation, "needs the name of the object it creates");
      const rejection = tooMany(1);
      if (rejection) return rejection;
      const resource = resolveResource(catalog, spec.resource);
      return isRejection(resource) ? resource : [{ resource, name }];
    }
  }
};

const manifestTargets = (input: KubectlFormsInput, objects: readonly ManifestObject[]): Target[] | FloorRejection => {
  const targets: Target[] = [];
  for (const object of objects) {
    const resource = findCatalogKind(input.catalog, object.apiVersion, object.kind);
    if (!resource) return unknownResource(`${object.kind} of ${object.apiVersion}`);
    targets.push({ resource, name: object.name, ...(object.namespace ? { namespace: object.namespace } : {}) });
  }
  return targets;
};

/** The canonical forms of a kubectl invocation, one per target, or the floor rejection of a target it cannot place. */
export function kubectlCanonicalForms(input: KubectlFormsInput): CanonicalForm[] | FloorRejection {
  const { invocation, manifestObjects, revealSecrets, defaultNamespace } = input;
  const { command } = invocation;
  if (invocation.commandArgs !== undefined && !command.takesCommand) {
    return unplaceable(invocation, "takes no command after --");
  }

  let targets: Target[] | FloorRejection | "verb-only";
  if (manifestObjects) {
    if (invocation.operands.length > 0) {
      return unplaceable(invocation, `takes its targets from the manifest, not from ${invocation.operands[0]}`);
    }
    targets = manifestTargets(input, manifestObjects);
  } else {
    targets = operandTargets(input);
  }
  if (isRejection(targets)) return targets;
  if (targets === "verb-only") {
    return command.takesManifest
      ? unplaceable(invocation, "needs the manifest parameter")
      : [{ program: "kubectl", verb: command.verb }];
  }

  const namespaceFlag = invocation.flags.get("--namespace");
  const namespace = isFlagOn(invocation, "--all-namespaces")
    ? "*"
    : namespaceFlag === undefined || namespaceFlag === ""
      ? defaultNamespace
      : namespaceFlag;

  const forms: CanonicalForm[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const reveal = revealSecrets && command.verb === "get" && target.resource.name === "secrets";
    const form: CanonicalForm = {
      program: "kubectl",
      verb: reveal ? "reveal" : command.verb,
      resource: target.resource.name,
      name: target.name,
      ...(target.resource.namespaced ? { namespace: target.namespace ?? namespace } : {}),
    };
    const key = JSON.stringify(form);
    if (seen.has(key)) continue;
    seen.add(key);
    forms.push(form);
  }
  return forms;
}
