import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnableLambda } from "@langchain/core/runnables";
import { toJsonSchema } from "@langchain/core/utils/json_schema";
import { z } from "zod";
import { requiresAutoToolChoice } from "../provider/model-capabilities";
import { useModelProvider } from "../provider/model-provider";
import { SUPERVISOR_PROMPT_TEMPLATE } from "../provider/prompt-template-provider";
import { recoverSupervisorRouting, SUPERVISOR_TOOL_NAME, type SupervisorRouting } from "./supervisor-routing";

import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { BaseMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import type { ChatOpenAI } from "@langchain/openai";

// Build the supervisor's structured-output runnable.
//
// We bind a single `extract` tool that carries the routing decision instead of
// using `response_format=json_schema`. This is deliberate: some models (e.g.
// gpt-5.4) occasionally emit the JSON object twice in a row with
// `response_format=json_schema` during streaming, which breaks the parser with
// "Unexpected non-whitespace character after JSON". Function calling avoids that
// because the payload is returned in a dedicated tool_call argument instead of
// being concatenated into the assistant text.
//
// The tool is normally forced via `tool_choice`. Some thinking models (DeepSeek,
// Qwen) reject a forced `tool_choice` while thinking mode is on (`Thinking mode
// does not support this tool_choice`), so for those we request `tool_choice:
// "auto"`, which they accept. With `auto` the model may answer in plain text
// instead of calling the tool once it considers the query resolved, so the
// routing decision is recovered from either the tool call or the text by
// `recoverSupervisorRouting`.
const buildSupervisorRunnable = <T extends z.ZodTypeAny>(
  model: ChatOpenAI,
  schema: T,
  destinations: readonly string[],
  subAgents: readonly string[],
): Runnable<BaseLanguageModelInput, SupervisorRouting | undefined> => {
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
    { tool_choice: requiresAutoToolChoice(model.model) ? "auto" : SUPERVISOR_TOOL_NAME },
  );
  return llm.pipe(
    RunnableLambda.from((message: BaseMessage) => recoverSupervisorRouting(message, destinations, subAgents)),
  );
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
    return formattedPrompt.pipe(buildSupervisorRunnable(model, supervisorResponseSchema, destinations, subAgents));
  };

  return { getAgent };
};
