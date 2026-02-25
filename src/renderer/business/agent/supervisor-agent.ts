import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { z } from "zod";
import { PreferencesStore } from "../../../common/store";
import { createLogger } from "../../../common/utils/logger/logger-service";
import { useModelProvider } from "../provider/model-provider";
import { SUPERVISOR_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";
import { isOllamaModel } from "./ollama-agent-helper";

/**
 * Attempts to extract a valid supervisor response from raw LLM text output.
 * Handles malformed JSON from small local models (e.g. Ollama granite4:1b)
 * that may include FIM tokens, typos, or embedded code in JSON values.
 */
function parseSupervisorResponse(
  text: string,
  validDestinations: readonly string[],
): { reflection: string; goto: string } | null {
  const { log } = createLogger("supervisorParser");

  // 1. Try direct JSON parse first
  try {
    const parsed = JSON.parse(text);
    if (parsed.goto && validDestinations.includes(parsed.goto)) {
      return { reflection: parsed.reflection || "", goto: parsed.goto };
    }
  } catch {
    // Not valid JSON, continue to extraction
  }

  // 2. Try to extract JSON object from the text (model may wrap it in markdown or extra text)
  const jsonMatch = text.match(/\{[\s\S]*?"goto"\s*:\s*"([^"]*)"[\s\S]*?\}/);
  if (jsonMatch) {
    const gotoValue = jsonMatch[1];
    // Check if the extracted goto is a valid destination
    if (gotoValue && validDestinations.includes(gotoValue)) {
      const reflectionMatch = text.match(/"reflection"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      return { reflection: reflectionMatch?.[1] || "", goto: gotoValue };
    }
    // The goto value may be garbled - try fuzzy matching against valid destinations
    if (gotoValue) {
      const fuzzyMatch = validDestinations.find(
        (dest) =>
          gotoValue.toLowerCase().includes(dest.toLowerCase()) || dest.toLowerCase().includes(gotoValue.toLowerCase()),
      );
      if (fuzzyMatch) {
        log.debug(`Fuzzy-matched goto "${gotoValue}" to "${fuzzyMatch}"`);
        return { reflection: "", goto: fuzzyMatch };
      }
    }
  }

  // 3. Keyword-based fallback: scan text for agent names
  const lowerText = text.toLowerCase();
  for (const dest of validDestinations) {
    if (dest !== "__end__" && lowerText.includes(dest.toLowerCase())) {
      log.debug(`Keyword fallback: found "${dest}" in model output`);
      return { reflection: "", goto: dest };
    }
  }

  // 4. If model mentions "end" or "complete" or "resolved", route to __end__
  if (/\b(end|complete|resolved|finish|done|no further)\b/i.test(text)) {
    log.debug("Keyword fallback: detected end/complete signal");
    return { reflection: "", goto: "__end__" };
  }

  log.warn(`Could not parse supervisor response: ${text.substring(0, 200)}`);
  return null;
}

export const useAgentSupervisor = () => {
  const model = useModelProvider().getModel();
  const preferencesStore = PreferencesStore.getInstanceOrCreate<PreferencesStore>();
  const { log } = createLogger("useAgentSupervisor");

  const getAgent = async (subAgents: string[], subAgentResponsibilities: string[]) => {
    if (!model) {
      return;
    }
    const destinations = ["__end__", ...subAgents] as const;

    const isOllama = isOllamaModel(preferencesStore.selectedModel);

    if (!isOllama) {
      // Cloud models (OpenAI, Gemini) — use reliable withStructuredOutput
      const supervisorResponseSchema = z.object({
        reflection: z.string().describe("The supervisor's reflection about the next step to take."),
        goto: z
          .enum(destinations)
          .describe(
            "The next agent to call, or __end__ if the user's query has been resolved. Must be one of the specified values.",
          ),
      });
      const prompt = ChatPromptTemplate.fromMessages([
        ["system", SUPERVISOR_PROMPT_TEMPLATE],
        new MessagesPlaceholder("messages"),
        [
          "human",
          "Given the conversation above, who should act next?" + " Or should we __end__? Select one of: {options}",
        ],
      ]);
      const formattedPrompt = await prompt.partial({
        options: destinations.join(", "),
        workerResponsibilities: subAgentResponsibilities.join(", "),
        members: subAgents.join(", "),
      });
      return formattedPrompt.pipe(model.withStructuredOutput(supervisorResponseSchema));
    }

    // Ollama models — use direct messages (no ChatPromptTemplate to avoid { } parsing issues)
    const optionsStr = destinations.join(", ");
    const responsibilitiesStr = subAgentResponsibilities.join(", ");
    const membersStr = subAgents.join(", ");

    const systemContent =
      SUPERVISOR_PROMPT_TEMPLATE.replace("{members}", membersStr).replace(
        "{workerResponsibilities}",
        responsibilitiesStr,
      ) +
      "\n\nIMPORTANT: You MUST respond with ONLY a valid JSON object, nothing else. No markdown, no code blocks, no explanation outside the JSON.\n" +
      "The JSON must have exactly two fields:\n" +
      '- "reflection": a short string explaining your reasoning\n' +
      `- "goto": one of these exact values: ${optionsStr}\n\n` +
      "Example response:\n" +
      '{"reflection": "The user wants to list pods, routing to kubernetes operator.", "goto": "kubernetesOperator"}\n';

    const humanContent =
      'Given the conversation above, who should act next? Respond with ONLY a JSON object containing "reflection" and "goto". ' +
      `The "goto" field must be exactly one of: ${optionsStr}`;

    return {
      invoke: async (input: { messages: any[] }) => {
        // Build message array directly — no template parsing
        const allMessages = [new SystemMessage(systemContent), ...input.messages, new HumanMessage(humanContent)];

        const response = await model.invoke(allMessages);
        const rawText = typeof response.content === "string" ? response.content : JSON.stringify(response.content);

        log.debug(`Ollama supervisor raw output: ${rawText.substring(0, 300)}`);

        const parsed = parseSupervisorResponse(rawText, destinations);
        if (parsed) {
          return parsed;
        }

        // Ultimate fallback: route to generalPurposeAgent so the user gets a response
        log.warn("Falling back to generalPurposeAgent due to unparseable supervisor output");
        return {
          reflection: "Unable to parse routing decision, falling back to general purpose agent.",
          goto: "generalPurposeAgent",
        };
      },
    };
  };

  return { getAgent };
};
