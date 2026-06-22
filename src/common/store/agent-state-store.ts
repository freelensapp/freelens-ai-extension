import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, toJS } from "mobx";

export interface AgentStateModel {
  // Serialized LangGraph checkpointer state, keyed by saver namespace
  // (e.g. "freelens", "mcp"). Each value is produced by
  // `serializeSaverState` in the renderer and is opaque to this store.
  checkpoints: Record<string, string>;
}

/**
 * Durable, host-managed persistence for the agents' LangGraph checkpointer
 * state. This is the Freelens-native place to store extension state: the host
 * writes it to a JSON file in the extension's data directory, so it survives an
 * application restart (unlike `MemorySaver`, whose state lives only in memory).
 *
 * The renderer's `PersistentMemorySaver` reads/writes the serialized blob here;
 * the store itself never interprets it.
 */
export class AgentStateStore extends Common.Store.ExtensionStore<AgentStateModel> {
  checkpoints: Record<string, string> = {};

  constructor() {
    super({
      configName: "freelens-ai-agent-state-store",
      defaults: {
        checkpoints: {},
      },
    });
    // Explicit annotation form instead of `@observable` decorators; see the
    // note in preferences-store.ts for why decorators do not work here.
    makeObservable(this, {
      checkpoints: observable,
    });
  }

  getCheckpoint(namespace: string): string | undefined {
    return this.checkpoints[namespace];
  }

  setCheckpoint(namespace: string, blob: string): void {
    // Replace the map so MobX sees a new reference and the host persists it.
    this.checkpoints = { ...this.checkpoints, [namespace]: blob };
  }

  clear(): void {
    this.checkpoints = {};
  }

  fromStore(model: AgentStateModel): void {
    this.checkpoints = model.checkpoints ?? {};
  }

  toJSON(): AgentStateModel {
    return {
      checkpoints: toJS(this.checkpoints),
    };
  }
}
