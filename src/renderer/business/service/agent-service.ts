import { isAIMessageChunk } from "@langchain/core/messages";
import { Command, Interrupt } from "@langchain/langgraph";

import type { FreelensAgent, MPCAgent } from "../../../common/store";

export interface AgentService {
  run(agentInput: object | Command, conversationId: string): AsyncGenerator<string | Interrupt, void, unknown>;
}

/**
 * This service takes an agent, runs it and streams the response back to the caller.
 * If the agent has any interrupts, it will yield those as well.
 * @returns
 * @param agent
 */
export const useAgentService = (agent: FreelensAgent | MPCAgent): AgentService => {
  const run = async function* (agentInput: object | Command, conversationId: string) {
    console.log("Starting Agent Service run for message: ", agentInput);

    let config = { thread_id: conversationId };
    const streamResponse = await agent.stream(agentInput, { streamMode: "messages", configurable: config });

    // streams LLM token by token to the UI
    for await (const [message, _metadata] of streamResponse) {
      if (isAIMessageChunk(message) && message.tool_call_chunks?.length) {
        // console.log(`${message.getType()} MESSAGE TOOL CALL CHUNK: ${message.tool_call_chunks[0].args}`);
      } else {
        if (message.getType() === "ai") {
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
  };

  return { run };
};
