import { Renderer } from "@freelensapp/extensions";
import {
  PROVIDER_COMMAND_CHANNEL,
  PROVIDER_ENVELOPE_CHANNEL,
  type ProviderCommand,
  type ProviderEnvelope,
  type ProviderResponse,
} from "../../../common/provider-protocol";
import { IpcConnection } from "../ipc-connection";

// The renderer side of the provider protocol. The settings page in the root
// window asks main for provider status and models, runs logins and receives
// their prompts. The chat in each cluster window lists the connected models and
// reloads them when main reports changed credentials.

class ProviderRendererIpc extends Renderer.Ipc {}

type EnvelopeListener = (envelope: ProviderEnvelope) => void;

const listeners = new Set<EnvelopeListener>();
const connection = new IpcConnection<ProviderEnvelope>(
  (extension) => ProviderRendererIpc.createInstance(extension),
  PROVIDER_ENVELOPE_CHANNEL,
);

export function startProviderClient(extension: Renderer.LensExtension): void {
  connection.connect(extension, (envelope) => {
    for (const listener of listeners) {
      listener(envelope);
    }
  });
}

/** Stops listening, on deactivation; the next activation connects again. */
export function stopProviderClient(): void {
  connection.disconnect();
}

export async function sendProviderCommand(command: ProviderCommand): Promise<ProviderResponse> {
  if (!connection.connected) {
    return { type: "response", command: command.type, success: false, error: "The provider settings are not ready." };
  }
  try {
    return (await connection.invoke(PROVIDER_COMMAND_CHANNEL, command)) as ProviderResponse;
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
