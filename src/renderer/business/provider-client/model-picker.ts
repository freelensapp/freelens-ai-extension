// Pure helpers for the chat's model picker. Free of host and MobX imports so
// they are unit-tested directly.

import type { ProviderModelSummary } from "../../../common/provider-protocol";

export interface ModelOption {
  /** "provider/id", the form the `agentModel` preference stores. */
  value: string;
  label: string;
}

export interface ModelGroup {
  label: string;
  options: ModelOption[];
}

export const modelRef = (model: Pick<ProviderModelSummary, "provider" | "id">): string =>
  `${model.provider}/${model.id}`;

/** The models of the connected providers, one group per provider, sorted by provider name. */
export const groupModels = (models: readonly ProviderModelSummary[]): ModelGroup[] => {
  const groups = new Map<string, ModelGroup>();
  for (const model of models) {
    let group = groups.get(model.provider);
    if (!group) {
      group = { label: model.providerName, options: [] };
      groups.set(model.provider, group);
    }
    group.options.push({ value: modelRef(model), label: model.name });
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
};

/**
 * The model the chat runs on: the remembered one while its provider is
 * connected, else the first one the picker lists, or undefined when no
 * provider is connected.
 */
export const resolvePickedModel = (models: readonly ProviderModelSummary[], saved: string): string | undefined => {
  if (models.some((model) => modelRef(model) === saved)) return saved;
  return groupModels(models)[0]?.options[0]?.value;
};
