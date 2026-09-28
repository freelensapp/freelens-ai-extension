// Durable storage for the Strands `SessionManager`.
//
// The agent runs in the renderer, where the Freelens-native place for durable
// extension state is a host-managed `ExtensionStore`: the host writes it to a
// JSON file in the extension's data directory, so it survives an application
// restart. This module adapts such a string key/value record to the Strands
// `Storage` interface (opaque bytes under `/`-separated keys), so the session
// manager can persist the agent snapshot (conversation + pending approvals)
// without touching the filesystem from the renderer.
//
// Pure: the backing record is injected, so the adapter and the session id
// helpers are unit-tested directly (see session-storage.test.ts).

import type { Storage } from "@strands-agents/sdk";

// Minimal string key/value backend. `AgentStateStore` implements it.
export interface KeyValueBackend {
  getEntry(key: string): string | undefined;
  setEntry(key: string, value: string): void;
  deleteEntry(key: string): void;
  entryKeys(): string[];
}

// Session ids may only contain lowercase letters, digits, hyphens and
// underscores (enforced by the SDK). Anything else is mapped to a hyphen.
const sanitizeIdentifier = (value: string): string => value.toLowerCase().replace(/[^a-z0-9_-]/g, "-");

// Separates the cluster part from the conversation part of a session id.
const SESSION_ID_SEPARATOR = "__";

/**
 * Session id of a conversation. It is cluster-qualified because the backing
 * store is a single file shared by every cluster frame: each cluster keeps its
 * own agent memory instead of overwriting (or reading) another cluster's.
 */
export function sessionIdFor(clusterId: string, conversationId: string): string {
  return `${sanitizeIdentifier(clusterId)}${SESSION_ID_SEPARATOR}${sanitizeIdentifier(conversationId)}`;
}

/**
 * Whether a stored key belongs to a session of the given cluster. Used to clear
 * only the current cluster's sessions without touching other clusters.
 */
export function belongsToClusterSession(key: string, clusterId: string): boolean {
  const sessionPrefix = `${sanitizeIdentifier(clusterId)}${SESSION_ID_SEPARATOR}`;
  return key.split("/").some((segment) => segment.startsWith(sessionPrefix));
}

// Collapses slash runs and strips leading/trailing slashes, like the SDK's
// path-based backends, so equivalent keys map to the same entry.
const normalizeKey = (key: string): string => key.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");

/**
 * Strands `Storage` backed by a string key/value record. Values are the UTF-8
 * JSON the session manager writes, stored as text so the host file stays
 * readable.
 */
export class KeyValueSessionStorage implements Storage {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(private readonly backend: KeyValueBackend) {}

  async write(key: string, data: Uint8Array): Promise<void> {
    this.backend.setEntry(normalizeKey(key), this.decoder.decode(data));
  }

  async read(key: string): Promise<Uint8Array | null> {
    const value = this.backend.getEntry(normalizeKey(key));
    return value === undefined ? null : this.encoder.encode(value);
  }

  async delete(key: string): Promise<void> {
    this.backend.deleteEntry(normalizeKey(key));
  }

  async list(prefix: string): Promise<string[]> {
    const normalizedPrefix = prefix.replace(/\/+/g, "/").replace(/^\//, "");
    return this.backend
      .entryKeys()
      .filter((key) => key.startsWith(normalizedPrefix))
      .sort();
  }
}
