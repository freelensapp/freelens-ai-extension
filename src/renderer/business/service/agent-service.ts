import { isAIMessageChunk } from "@langchain/core/messages";
import { Command, Interrupt } from "@langchain/langgraph";
import { FreeLensAgent } from "../agent/freelens-agent-system";
import { MPCAgent } from "../agent/mcp-agent";

const MAX_GEMINI_STREAM_RETRIES = 3;
const BASE_BACKOFF_MS = 700;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isGeminiTransientError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    message.includes("failed to parse stream") ||
    message.includes("503") ||
    message.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("429") ||
    message.includes("too many requests")
  );
};

const getRetryDelay = (attempt: number) => {
  const jitter = Math.floor(Math.random() * 250);

  return BASE_BACKOFF_MS * 2 ** (attempt - 1) + jitter;
};

export interface AgentService {
  run(agentInput: object | Command, conversationId: string): AsyncGenerator<string | Interrupt, void, unknown>;
}

/**
 * This service takes an agent, runs it and streams the response back to the caller.
 * If the agent has any interrupts, it will yield those as well.
 * @returns
 * @param agent
 */
export const useAgentService = (agent: FreeLensAgent | MPCAgent): AgentService => {
  const run = async function* (agentInput: object | Command, conversationId: string) {
    console.log("Starting Agent Service run for message: ", agentInput);

    let config = { thread_id: conversationId };
    for (let attempt = 1; attempt <= MAX_GEMINI_STREAM_RETRIES + 1; attempt++) {
      let hasYieldedContent = false;

      try {
        const streamResponse = await agent.stream(agentInput, { streamMode: "messages", configurable: config });

        // streams LLM token by token to the UI
        for await (const [message, _metadata] of streamResponse) {
          if (isAIMessageChunk(message) && message.tool_call_chunks?.length) {
            // console.log(`${message.getType()} MESSAGE TOOL CALL CHUNK: ${message.tool_call_chunks[0].args}`);
          } else {
            if (message.getType() === "ai") {
              hasYieldedContent = true;
              yield String(message.content);
            }
          }
        }

        yield "\n";

        // checks the agent state for any interrupts
        const agentState = await agent.getState({ configurable: config });
        console.log("Agent state: ", agentState);
        if (agentState.next) {
          console.log("Agent state next: ", agentState.next);
          for (const task of agentState.tasks) {
            if (task.interrupts) {
              console.log("Agent state task interrupts: ", task.interrupts);
              for (const interrupt of task.interrupts) {
                console.log("Agent state task interrupt: ", interrupt);
                yield interrupt;
              }
            }
          }
        }

        return;
      } catch (error) {
        const canRetry = !hasYieldedContent && isGeminiTransientError(error) && attempt <= MAX_GEMINI_STREAM_RETRIES;

        if (!canRetry) {
          throw error;
        }

        await wait(getRetryDelay(attempt));
      }
    }
  };

  return { run };
};
