// The backup on an approval card: the current YAML of the object a call would
// change, loaded by the approval gate before it asks, so the change can be
// undone by hand.

import { stringify as stringifyYaml } from "yaml";
import {
  deleteKubernetesResourceTool,
  deletePodTool,
  patchKubernetesResourceTool,
  restartKubernetesResourceTool,
  updateKubernetesResourceTool,
} from "../../../common/agent-tools";
import { type ClusterToolContext, type RawObject, resolveResource } from "./cluster-api";
import { resourcePath } from "./resource-paths";

import type { ApprovalTarget } from "../../../common/agent-protocol";

// The tools that change an existing object; a create has nothing to back up.
const TOOLS_CHANGING_AN_OBJECT: ReadonlySet<string> = new Set([
  updateKubernetesResourceTool.name,
  patchKubernetesResourceTool.name,
  deleteKubernetesResourceTool.name,
  deletePodTool.name,
  restartKubernetesResourceTool.name,
]);

/** Whether the approval of a call to this tool carries a backup. */
export const hasApprovalBackup = (toolName: string): boolean => TOOLS_CHANGING_AN_OBJECT.has(toolName);

/**
 * The YAML of the object the approval is about (apiVersion, kind, metadata,
 * spec, status), or undefined when the target names no object or the cluster
 * does not serve its kind. Rejects when the object cannot be loaded.
 */
export async function loadApprovalBackup(
  context: Pick<ClusterToolContext, "api" | "signal">,
  { kind, apiVersion, name, namespace }: ApprovalTarget,
): Promise<string | undefined> {
  if (!kind || !name) return undefined;
  const resource = await resolveResource(context, kind, apiVersion);
  if (typeof resource === "string" || (resource.namespaced && !namespace)) return undefined;
  const object = await context.api.get<RawObject>(resourcePath(resource, { name, namespace }), undefined, {
    signal: context.signal,
  });
  return stringifyYaml({
    apiVersion: object.apiVersion ?? resource.apiVersion,
    kind: object.kind ?? resource.kind,
    metadata: object.metadata,
    spec: object.spec,
    status: object.status,
  });
}
