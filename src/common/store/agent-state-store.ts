import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, toJS } from "mobx";
import { belongsToClusterSession, type KeyValueBackend } from "../../renderer/business/agent/session-storage";

export interface AgentStateModel {
  // Strands session data written by the agent's `SessionManager` (agent
  // snapshots and manifests), keyed by storage key. Keys embed the
  // cluster-qualified session id (see `sessionIdFor`) so each cluster's agent
  // memory is stored independently. Values are opaque JSON text.
  sessions: Record<string, string>;
}

/**
 * Durable, host-managed persistence for the agent sessions. This is the
 * Freelens-native place to store extension state: the host writes it to a JSON
 * file in the extension's data directory, so the conversation (and any pending
 * approval) survives an application restart.
 *
 * The renderer's `KeyValueSessionStorage` reads/writes entries here on behalf of
 * the Strands `SessionManager`; the store itself never interprets them.
 * Checkpoints written by the former LangGraph agents are not portable to
 * Strands and are dropped on load.
 */
export class AgentStateStore extends Common.Store.ExtensionStore<AgentStateModel> implements KeyValueBackend {
  sessions: Record<string, string> = {};

  constructor() {
    super({
      configName: "freelens-ai-agent-state-store",
      defaults: {
        sessions: {},
      },
    });
    // Explicit annotation form instead of `@observable` decorators; see the
    // note in preferences-store.ts for why decorators do not work here.
    makeObservable(this, {
      sessions: observable,
    });
  }

  getEntry(key: string): string | undefined {
    return this.sessions[key];
  }

  setEntry(key: string, value: string): void {
    // Replace the map so MobX sees a new reference and the host persists it.
    this.sessions = { ...this.sessions, [key]: value };
  }

  deleteEntry(key: string): void {
    if (!(key in this.sessions)) {
      return;
    }
    const { [key]: _removed, ...remaining } = this.sessions;
    this.sessions = remaining;
  }

  entryKeys(): string[] {
    return Object.keys(this.sessions);
  }

  clear(): void {
    this.sessions = {};
  }

  // Drop only the sessions that belong to the given cluster, leaving every
  // other cluster's agent memory untouched. Used when the user clears the chat
  // so a "Clear" in one cluster does not wipe another cluster's conversation.
  clearForCluster(clusterId: string): void {
    const remaining: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.sessions)) {
      if (!belongsToClusterSession(key, clusterId)) {
        remaining[key] = value;
      }
    }
    this.sessions = remaining;
  }

  fromStore(model: Partial<AgentStateModel>): void {
    this.sessions = model.sessions ?? {};
  }

  toJSON(): AgentStateModel {
    return {
      sessions: toJS(this.sessions),
    };
  }
}
