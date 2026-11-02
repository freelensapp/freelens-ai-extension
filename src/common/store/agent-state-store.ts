import { Common } from "@freelensapp/extensions";
import { makeObservable, observableRef, toJS } from "mobx";
import { belongsToCluster } from "../agent/checkpoint-namespace";

// A message of an agent's conversation, as main stores it: a model message of
// the AI SDK, plain JSON. Opaque to this store.
export type StoredAgentMessage = Record<string, unknown>;

// The conversations of one agent of one cluster, by conversation id.
export type StoredConversations = Record<string, StoredAgentMessage[]>;

export interface AgentStateModel {
  // The conversations of the agents, keyed by a namespace of the cluster and
  // the agent (e.g. "<clusterId>::freelens", "<clusterId>::mcp", see
  // `checkpointNamespace`), so each cluster's agent memory is stored
  // independently.
  conversations: Record<string, StoredConversations>;
  // The serialized LangGraph checkpoints of earlier versions. They are not
  // read: `fromStore` drops them, and `toJSON` no longer writes them.
  checkpoints?: unknown;
}

/**
 * Durable, host-managed persistence for the agents' conversations. The host
 * writes it to a JSON file in the extension's data directory, so the model-side
 * conversation survives an application restart.
 *
 * Only main loads it: the agent runtime reads and writes the messages here, and
 * the store itself never interprets them.
 */
export class AgentStateStore extends Common.Store.ExtensionStore<AgentStateModel> {
  conversations: Record<string, StoredConversations> = {};

  constructor() {
    super({
      configName: "freelens-ai-agent-state-store",
      defaults: {
        conversations: {},
      },
    });
    // Explicit annotation form instead of `@observable` decorators; see the
    // note in preferences-store.ts for why decorators do not work here. A
    // reference only: the messages stay plain objects, which the AI SDK
    // structure-clones, and every write replaces the map.
    makeObservable(this, {
      conversations: observableRef,
    });
  }

  getConversation(namespace: string, conversationId: string): StoredAgentMessage[] {
    return this.conversations[namespace]?.[conversationId] ?? [];
  }

  setConversation(namespace: string, conversationId: string, messages: StoredAgentMessage[]): void {
    // Replace the maps so MobX sees a new reference and the host persists it.
    this.conversations = {
      ...this.conversations,
      [namespace]: { ...this.conversations[namespace], [conversationId]: messages },
    };
  }

  clear(): void {
    this.conversations = {};
  }

  // Drop only the conversations that belong to the given cluster, leaving every
  // other cluster's agent memory untouched. Used when the user clears the chat
  // so a "Clear" in one cluster does not wipe another cluster's conversation.
  clearForCluster(clusterId: string): void {
    const remaining: Record<string, StoredConversations> = {};
    for (const [namespace, conversations] of Object.entries(this.conversations)) {
      if (!belongsToCluster(namespace, clusterId)) {
        remaining[namespace] = conversations;
      }
    }
    this.conversations = remaining;
  }

  fromStore(model: AgentStateModel): void {
    // The LangGraph checkpoints of an earlier version cannot be read into
    // messages; they are left out without an error, and the next save drops
    // them from the file.
    this.conversations = model.conversations ?? {};
  }

  toJSON(): AgentStateModel {
    return {
      conversations: toJS(this.conversations),
    };
  }
}
