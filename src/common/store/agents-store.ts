import { Common } from "@freelensapp/extensions";
import { makeObservable, observable, toJS } from "mobx";
import { FreeLensAgent } from "../../renderer/business/agent/freelens-agent-system";
import { MPCAgent } from "../../renderer/business/agent/mcp-agent";

export class AgentsStore extends Common.Store.ExtensionStore {
  @observable freeLensAgent: FreeLensAgent | null = null;
  @observable mcpAgent: MPCAgent | null = null;

  constructor() {
    super({
      configName: "freelens-ai-agents-store",
    });
    makeObservable(this);
  }

  fromStore(): void {}

  toJSON() {
    return toJS({});
  }
}
