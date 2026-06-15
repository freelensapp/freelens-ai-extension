import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, toJS } from "mobx";
import { FreeLensAgent } from "../../renderer/business/agent/freelens-agent-system";
import { MPCAgent } from "../../renderer/business/agent/mcp-agent";

export class AgentsStore extends Common.Store.ExtensionStore {
  freeLensAgent: FreeLensAgent | null = null;
  mcpAgent: MPCAgent | null = null;

  constructor() {
    super({
      configName: "freelens-ai-agents-store",
    });
    // Use the explicit annotation form instead of `@observable` decorators;
    // see the note in preferences-store.ts for why decorators do not work here.
    makeObservable(this, {
      freeLensAgent: observable,
      mcpAgent: observable,
    });
  }

  fromStore(): void {}

  toJSON() {
    return toJS({});
  }
}
