// Pure helper for combining a base agent system prompt with the user's custom
// agent rules from preferences. Kept free of any host (`@freelensapp/extensions`)
// or MobX dependency so it can be unit-tested in isolation; the store-aware
// wrapper lives in `agent-rules-provider.ts`.

// Appends the user-provided custom agent rules to a base system prompt. Returns
// the base prompt unchanged when no rules are provided (empty or whitespace).
export const appendCustomAgentRules = (basePrompt: string, customRules: string | null | undefined): string => {
  const trimmed = (customRules ?? "").trim();
  if (!trimmed) {
    return basePrompt;
  }
  return `${basePrompt}

<custom_rules>
The user provided the following additional rules. Apply them on top of the instructions above. If any rule conflicts with a safety constraint or a tool-calling rule stated above, the instructions above take precedence.
${trimmed}
</custom_rules>`;
};
