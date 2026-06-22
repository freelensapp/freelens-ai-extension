import { MemorySaver } from "@langchain/langgraph";
import { AgentStateStore } from "../../../common/store/agent-state-store";
import { deserializeSaverState, serializeSaverState } from "./checkpoint-serialization";

/**
 * A `MemorySaver` whose checkpoint state is mirrored into the durable,
 * host-managed `AgentStateStore`. The base `MemorySaver` keeps everything in
 * memory and is wiped on every application restart; this subclass restores the
 * previous state on first use and writes it back after every mutation, so the
 * agent retains the prior conversation as live context across restarts. The
 * persisted transcript shown in the UI is handled separately (chat-session
 * storage); this is the model-side counterpart.
 *
 * Each saver instance owns a `namespace` (e.g. "freelens", "mcp") so the
 * Freelens and MCP agents persist independently and never overwrite each other.
 */
export class PersistentMemorySaver extends MemorySaver {
  private hydrated = false;

  constructor(
    private readonly namespace: string,
    private readonly store: AgentStateStore = AgentStateStore.getInstanceOrCreate<AgentStateStore>(),
  ) {
    super();
  }

  // Restore persisted state lazily on first use rather than in the constructor:
  // the store loads asynchronously at extension activation, while the agent
  // graph is built eagerly during the first React render. Deferring hydration to
  // the first checkpoint operation (which only happens once the user interacts)
  // guarantees the store is populated by then.
  private ensureHydrated(): void {
    if (this.hydrated) {
      return;
    }
    this.hydrated = true;

    const blob = this.store.getCheckpoint(this.namespace);
    if (!blob) {
      return;
    }

    const { storage, writes } = deserializeSaverState(blob);
    Object.assign(this.storage, storage);
    Object.assign(this.writes, writes);
  }

  private persist(): void {
    this.store.setCheckpoint(this.namespace, serializeSaverState({ storage: this.storage, writes: this.writes }));
  }

  async getTuple(...args: Parameters<MemorySaver["getTuple"]>): ReturnType<MemorySaver["getTuple"]> {
    this.ensureHydrated();
    return super.getTuple(...args);
  }

  async *list(...args: Parameters<MemorySaver["list"]>): ReturnType<MemorySaver["list"]> {
    this.ensureHydrated();
    yield* super.list(...args);
  }

  async put(...args: Parameters<MemorySaver["put"]>): ReturnType<MemorySaver["put"]> {
    // Hydrate before writing so a new run merges onto the restored threads
    // instead of overwriting them with an empty store.
    this.ensureHydrated();
    const result = await super.put(...args);
    this.persist();
    return result;
  }

  async putWrites(...args: Parameters<MemorySaver["putWrites"]>): ReturnType<MemorySaver["putWrites"]> {
    this.ensureHydrated();
    await super.putWrites(...args);
    this.persist();
  }

  async deleteThread(...args: Parameters<MemorySaver["deleteThread"]>): ReturnType<MemorySaver["deleteThread"]> {
    this.ensureHydrated();
    await super.deleteThread(...args);
    this.persist();
  }
}
