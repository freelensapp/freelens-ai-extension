import { readStoredCredential } from "@earendil-works/pi-coding-agent";

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

// pi 1.0.3 renamed the Azure provider and does not move what was saved under
// the old id: a key left there is ignored and a saved model is unknown.
const OLD_AZURE_PROVIDER_ID = "azure-openai-responses";
const AZURE_PROVIDER_ID = "azure";

/**
 * Moves an Azure key saved under the old provider id to `azure`, unless
 * `azure` has its own key already, and removes the old entry. Azure's login
 * stores only the key, so logging in with it saves the same credential.
 */
export async function migrateAzureCredential(modelRuntime: ModelRuntime, authPath: string): Promise<void> {
  const old = readStoredCredential(OLD_AZURE_PROVIDER_ID, authPath);
  if (!old) return;
  if (old.type === "api_key" && old.key && !readStoredCredential(AZURE_PROVIDER_ID, authPath)) {
    const key = old.key;
    await modelRuntime.login(AZURE_PROVIDER_ID, "api_key", {
      prompt: async () => key,
      notify: () => undefined,
    });
  }
  await modelRuntime.logout(OLD_AZURE_PROVIDER_ID);
}

/** The saved "provider/id" of the chat's model, with the old Azure provider id replaced. */
export const renameAzureModelRef = (ref: string): string =>
  ref.startsWith(`${OLD_AZURE_PROVIDER_ID}/`)
    ? `${AZURE_PROVIDER_ID}/${ref.slice(OLD_AZURE_PROVIDER_ID.length + 1)}`
    : ref;
