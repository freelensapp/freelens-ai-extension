import { Renderer } from "@freelensapp/extensions";
import {
  PROVIDER_COMMAND_CHANNEL,
  PROVIDER_ENVELOPE_CHANNEL,
  type ProviderCommand,
  type ProviderEnvelope,
  type ProviderResponse,
} from "../../../common/provider-protocol";
import { getFrameClusterId } from "../cluster/active-cluster";

// The settings page's side of the provider protocol: it asks main for provider
// status and models, runs logins and receives their prompts. Only the root
// window takes part, because the settings page lives there.

class ProviderRendererIpc extends Renderer.Ipc {}

type EnvelopeListener = (envelope: ProviderEnvelope) => void;

const listeners = new Set<EnvelopeListener>();
let ipc: ProviderRendererIpc | undefined;

export function startProviderClient(extension: Renderer.LensExtension): void {
  if (getFrameClusterId() || ipc) {
    return;
  }
  ipc = ProviderRendererIpc.createInstance(extension) as ProviderRendererIpc;
  ipc.listen(PROVIDER_ENVELOPE_CHANNEL, (_event, envelope: ProviderEnvelope) => {
    for (const listener of listeners) {
      listener(envelope);
    }
  });
}

export async function sendProviderCommand(command: ProviderCommand): Promise<ProviderResponse> {
  if (!ipc) {
    return { type: "response", command: command.type, success: false, error: "The provider settings are not ready." };
  }
  try {
    return await ipc.invoke(PROVIDER_COMMAND_CHANNEL, command);
  } catch (error) {
    return {
      type: "response",
      command: command.type,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Calls `listener` with every envelope main sends until the returned function is called. */
export function onProviderEnvelope(listener: EnvelopeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
