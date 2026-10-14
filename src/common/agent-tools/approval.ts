import { stringify as stringifyYaml } from "yaml";
import {
  DEFAULT_DELETE_MODE,
  type Manifest,
  normalizeSubresource,
  prepareManifest,
  resolveApiVersion,
  validateManifest,
} from "./resource-handlers";

import type { ApprovalTarget } from "../agent-protocol";

/**
 * A tool call made ready for the user to approve: the input that will run if
 * approved, the card's title, and the action as YAML. Or the reason the call
 * is rejected before anyone is asked.
 */
export type PreparedApproval =
  | { ok: true; input: Record<string, unknown>; title: string; message: string; approval: ApprovalTarget }
  | { ok: false; error: string };

const str = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined);
const asManifest = (value: unknown): Manifest =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Manifest) : {};

// The YAML is what the card shows under "Action details"; `yaml` leaves undefined fields out.
const approved = (
  input: Record<string, unknown>,
  action: string,
  details: Record<string, unknown>,
  approval: ApprovalTarget,
): PreparedApproval => ({ ok: true, input, title: action, message: stringifyYaml({ action, ...details }), approval });

function validated(kind: string, data: unknown): { manifest: Manifest } | { error: string } {
  const validation = validateManifest(kind, asManifest(data));
  if (!validation.success) {
    return { error: `The ${kind} manifest is invalid: ${validation.error}` };
  }
  return { manifest: prepareManifest(kind, validation.data) };
}

/**
 * Validates and prepares a call that needs approval. It runs in main before
 * the user is asked, so an invalid manifest is rejected without asking and the
 * user approves exactly the input that the frame will run.
 */
export function prepareApproval(toolName: string, input: Record<string, unknown>): PreparedApproval {
  const kind = str(input.kind) ?? "";
  const name = str(input.name);
  const namespace = str(input.namespace);
  const target = (overrides: Partial<ApprovalTarget> = {}): ApprovalTarget => ({
    tool: toolName,
    kind,
    apiVersion: resolveApiVersion(kind, str(input.apiVersion)),
    name,
    namespace,
    ...overrides,
  });

  switch (toolName) {
    case "createKubernetesResource": {
      const result = validated(kind, input.data);
      if ("error" in result) return { ok: false, error: result.error };
      const metadata = asManifest(result.manifest.metadata);
      const resourceName = name ?? str(metadata.name);
      const resourceNamespace = namespace ?? str(metadata.namespace);
      if (!resourceName) {
        return { ok: false, error: `Could not determine the name for the ${kind} to create.` };
      }
      return approved(
        { ...input, name: resourceName, namespace: resourceNamespace, data: result.manifest },
        `CREATE ${kind.toUpperCase()}`,
        { name: resourceName, namespace: resourceNamespace, data: result.manifest },
        target({ name: resourceName, namespace: resourceNamespace }),
      );
    }

    case "updateKubernetesResource": {
      const result = validated(kind, input.data);
      if ("error" in result) return { ok: false, error: result.error };
      return approved(
        { ...input, data: result.manifest },
        `UPDATE ${kind.toUpperCase()}`,
        { name, namespace, data: result.manifest },
        target(),
      );
    }

    case "patchKubernetesResource": {
      const subresource = normalizeSubresource(str(input.subresource));
      const { subresource: _raw, ...rest } = input;
      return approved(
        subresource ? { ...rest, subresource } : rest,
        `PATCH ${kind.toUpperCase()}`,
        { name, namespace, subresource, data: input.data },
        target(),
      );
    }

    case "deleteKubernetesResource": {
      const mode = str(input.mode) ?? DEFAULT_DELETE_MODE;
      return approved({ ...input, mode }, `DELETE ${kind.toUpperCase()}`, { name, namespace, mode }, target());
    }

    case "deletePod":
      return approved(
        input,
        `DELETE POD (${str(input.mode)})`,
        { name, namespace, mode: input.mode },
        target({ kind: "Pod", apiVersion: "v1" }),
      );

    case "restartKubernetesResource":
      return approved(input, `RESTART ${kind.toUpperCase()}`, { name, namespace }, target({ apiVersion: "apps/v1" }));

    case "getPodLogs":
      return approved(
        input,
        "READ LOGS POD",
        { name, namespace, container: input.container, previous: input.previous },
        target({ kind: "Pod", apiVersion: "v1" }),
      );

    // A tool without its own preparation: ask with its arguments as they are.
    default:
      return approved(input, toolName.toUpperCase(), input, { tool: toolName });
  }
}
