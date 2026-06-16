import { JsonOutputKeyToolsParser } from "@langchain/core/output_parsers/openai_tools";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { z } from "zod";
import { requiresAutoToolChoice } from "../provider/model-capabilities";
import { useModelProvider } from "../provider/model-provider";
import { SUPERVISOR_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";

import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { Runnable } from "@langchain/core/runnables";
import type { ChatOpenAI } from "@langchain/openai";

// Name of the single structured-output tool bound for the supervisor. Matches
// the default `withStructuredOutput` function-calling tool name so the parser
// behaves identically across the forced and "auto" tool_choice paths.
const SUPERVISOR_TOOL_NAME = "extract";

// Build the supervisor's structured-output runnable.
//
// By default we force function calling: `withStructuredOutput(..., { method:
// "functionCalling" })` binds a single tool and sets a forced `tool_choice`.
// This is deliberate: some models (e.g. gpt-5.4) occasionally emit the JSON
// object twice in a row with `response_format=json_schema` during streaming,
// which breaks the parser with "Unexpected non-whitespace character after JSON".
// Function calling avoids that because the payload is returned in a dedicated
// tool_call argument instead of being concatenated into the assistant text.
//
// Some thinking models (DeepSeek, Qwen) reject a forced `tool_choice` while
// thinking mode is on (`Thinking mode does not support this tool_choice`). For
// those we bind the same single tool but with `tool_choice: "auto"`, which they
// accept, and parse the tool call exactly like the function-calling path does.
const buildSupervisorRunnable = <T extends z.ZodTypeAny>(
  model: ChatOpenAI,
  schema: T,
): Runnable<BaseLanguageModelInput, z.infer<T>> => {
  if (!requiresAutoToolChoice(model.model)) {
    return model.withStructuredOutput(schema, { method: "functionCalling" });
  }

  const asJsonSchema = toJsonSchema(schema);
  const llm = model.bindTools(
    [
      {
        type: "function",
        function: {
          name: SUPERVISOR_TOOL_NAME,
          description: asJsonSchema.description,
          parameters: asJsonSchema,
        },
      },
    ],
    { tool_choice: "auto" },
  );
  const parser = new JsonOutputKeyToolsParser<z.infer<T>>({
    returnSingle: true,
    keyName: SUPERVISOR_TOOL_NAME,
    zodSchema: schema,
  });
  return llm.pipe(parser);
};

export const useAgentSupervisor = () => {
  const model = useModelProvider().getModel();

  const getAgent = async (subAgents: string[], subAgentResponsibilities: string[]) => {
    if (!model) {
      return;
    }
    const destinations = ["__end__", ...subAgents] as const;
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
    return formattedPrompt.pipe(buildSupervisorRunnable(model, supervisorResponseSchema));
  };

  return { getAgent };
};
