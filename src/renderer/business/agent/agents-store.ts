import { makeObservable, observable } from "mobx";
import { FreeLensAgent } from "./freelens-agent-system";
import { MPCAgent } from "./mcp-agent";

// Holds the agent instances of this cluster frame, so they survive the chat
// page being unmounted and mounted again. Nothing here is persisted.
export class AgentsStore {
  freeLensAgent: FreeLensAgent | null = null;
  mcpAgent: MPCAgent | null = null;

  constructor() {
    // The annotation map rather than decorators; see the note in
    // preferences-store.ts.
    makeObservable(this, {
      freeLensAgent: observable,
      mcpAgent: observable,
    });
  }
}

export const agentsStore = new AgentsStore();
