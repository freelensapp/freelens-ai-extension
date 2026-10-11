// A custom OpenAI-compatible endpoint, as the settings form enters it and as
// main writes it into pi's `models.json`. Shared so the form shows the same
// errors main would refuse with.

export interface CustomProviderInput {
  name: string;
  baseUrl: string;
  /** Empty for endpoints without auth, such as a local Ollama. */
  apiKey?: string;
  modelIds: string[];
  /** The models take a reasoning effort (pi's thinking level). */
  reasoning: boolean;
}

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  modelIds: string[];
  reasoning: boolean;
}

export type CustomProviderValidation = { ok: true; provider: CustomProvider } | { ok: false; error: string };

/** Splits the form's model field on commas and new lines, trimmed and without duplicates. */
export const parseModelIds = (text: string): string[] => [
  ...new Set(
    text
      .split(/[,\n]/)
      .map((id) => id.trim())
      .filter(Boolean),
  ),
];

/** A provider id from the display name, e.g. "My LiteLLM" becomes "my-litellm". */
export const customProviderId = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Checks and normalizes the form's input; `taken` holds the ids of every provider pi already knows. */
export const validateCustomProvider = (
  input: CustomProviderInput,
  taken: ReadonlySet<string> = new Set(),
): CustomProviderValidation => {
  const name = input.name.trim();
  if (!name) {
    return { ok: false, error: "Enter a name for the endpoint." };
  }
  const id = customProviderId(name);
  if (!id) {
    return { ok: false, error: "The name needs at least one letter or digit." };
  }
  if (taken.has(id)) {
    return { ok: false, error: `A provider with the id "${id}" already exists. Choose another name.` };
  }

  const rawUrl = input.baseUrl.trim();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: "Enter the base URL as a full address, e.g. http://localhost:11434/v1." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "The base URL must start with http:// or https://." };
  }

  const modelIds = [...new Set(input.modelIds.map((modelId) => modelId.trim()).filter(Boolean))];
  if (modelIds.length === 0) {
    return { ok: false, error: "Enter at least one model id." };
  }

  return {
    ok: true,
    provider: {
      id,
      name,
      baseUrl: rawUrl.replace(/\/+$/, ""),
      apiKey: input.apiKey?.trim() ?? "",
      modelIds,
      reasoning: input.reasoning,
    },
  };
};
