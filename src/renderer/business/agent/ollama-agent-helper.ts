/**
 * Copyright (c) 2026 Freelens Authors
 *
 * Licensed under the MIT License
 *
 * Helper for creating LangGraph-compatible agents for Ollama models
 * that don't support native tool calling. This implements prompt-based
 * tool invocation with manual parsing and execution.
 *
 * NOTE: This file intentionally avoids ChatPromptTemplate because
 * tool descriptions and JSON examples contain literal { } characters
 * that conflict with LangChain's template variable syntax.
 *
 * Tried this after testing that route, but open for discussion
 * if there is a cleaner way to integrate with ChatPromptTemplate
 * without losing the ability to include literal { } in the prompt.
 */

import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { MessagesAnnotation, StateGraph } from "@langchain/langgraph";
import { SUPPORTED_OLLAMA_MODELS } from "../../../common/constants/ollama-models";
import { createLogger } from "../../../common/utils/logger/logger-service";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";

const { log } = createLogger("ollamaAgentHelper");

/**
 * Describes available tools in a format the LLM can understand via prompt.
 */
function describeToolsForPrompt(tools: StructuredToolInterface[]): string {
  if (tools.length === 0) return "You have no tools available. Answer directly.";

  const descriptions = tools.map((t) => {
    const schema = t.schema;
    let params = "No parameters required.";
    if (schema && "shape" in schema) {
      const shape = (schema as any).shape;
      if (shape && Object.keys(shape).length > 0) {
        params = Object.entries(shape)
          .map(([key, val]: [string, any]) => {
            const desc = val?.description || val?._def?.typeName || "unknown";
            return `  - "${key}": ${desc}`;
          })
          .join("\n");
      }
    }
    return `Tool: "${t.name}"\n  Description: ${t.description}\n  Parameters:\n${params}`;
  });

  return (
    "You have the following tools available:\n\n" +
    descriptions.join("\n\n") +
    "\n\n" +
    "To call a tool, respond with ONLY a JSON object in this exact format (no markdown, no extra text):\n" +
    '{"tool": "<tool_name>", "args": {<arguments>}}\n\n' +
    "If no tool is needed and you want to give a final answer, respond with:\n" +
    '{"tool": "FINAL_ANSWER", "args": {"answer": "<your response>"}}\n\n' +
    "IMPORTANT RULES:\n" +
    "- Respond with ONLY ONE JSON object per turn, nothing else.\n" +
    "- Do not wrap JSON in markdown code blocks.\n" +
    "- Do not include any text before or after the JSON.\n" +
    '- For tools requiring a namespace parameter, if the user says "all namespaces", ' +
    'you must first call "getNamespaces" to get the list, then call tools for each namespace.\n' +
    "- Always use tool names EXACTLY as listed above."
  );
}

/**
 * Parses model output to extract a tool call.
 * Handles malformed JSON from small models gracefully.
 */
function parseToolCall(text: string, validToolNames: string[]): { tool: string; args: Record<string, any> } | null {
  // Strip markdown code fences if present
  let cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  // 1. Direct JSON parse
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.tool) {
      return { tool: parsed.tool, args: parsed.args || {} };
    }
  } catch {
    // Continue to extraction
  }

  // 2. Extract JSON object from surrounding text
  const jsonMatch = cleaned.match(/\{[\s\S]*?"tool"\s*:\s*"([^"]*)"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      // Try to parse just the matched JSON block
      const fullMatch = jsonMatch[0];
      const parsed = JSON.parse(fullMatch);
      if (parsed.tool) {
        return { tool: parsed.tool, args: parsed.args || {} };
      }
    } catch {
      // Extract tool name from regex
      const toolName = jsonMatch[1];
      if (toolName) {
        // Try to extract args
        const argsMatch = cleaned.match(/"args"\s*:\s*(\{[^}]*\})/);
        let args = {};
        if (argsMatch) {
          try {
            args = JSON.parse(argsMatch[1]);
          } catch {
            /* ignore */
          }
        }
        return { tool: toolName, args };
      }
    }
  }

  // 3. keyword-based: look for tool names mentioned in the text
  const lowerText = cleaned.toLowerCase();

  // Check for FINAL_ANSWER indicators
  if (
    lowerText.includes("final_answer") ||
    lowerText.includes("final answer") ||
    (!validToolNames.some((t) => lowerText.includes(t.toLowerCase())) && cleaned.length > 20)
  ) {
    return { tool: "FINAL_ANSWER", args: { answer: cleaned } };
  }

  for (const name of validToolNames) {
    if (lowerText.includes(name.toLowerCase())) {
      // Try to extract namespace or other simple args
      const nsMatch = cleaned.match(/namespace["\s:]*["']?([a-zA-Z0-9_-]+)["']?/i);
      const args: Record<string, any> = {};
      if (nsMatch) {
        args.namespace = nsMatch[1];
      }
      return { tool: name, args };
    }
  }

  // 4. If text looks like a direct answer, treat it as final
  if (cleaned.length > 10) {
    return { tool: "FINAL_ANSWER", args: { answer: cleaned } };
  }

  return null;
}

/**
 * Creates a LangGraph-compatible agent for Ollama models without native tool calling.
 * Uses a prompt-based approach: describes tools in the system prompt, then parses
 * the model's text output to identify tool invocations.
 *
 * @param model - The ChatOpenAI model pointing at Ollama
 * @param tools - Array of LangChain tools available to the agent
 * @param systemPrompt - The agent's system prompt (role description)
 * @param maxIterations - Maximum tool-calling iterations (default 5)
 */
export function createOllamaReactAgent(
  model: BaseChatModel,
  tools: StructuredToolInterface[],
  systemPrompt: string,
  maxIterations = 5,
) {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const validToolNames = tools.map((t) => t.name);

  const agentNode = async (state: { messages: any[] }) => {
    const toolDescription = describeToolsForPrompt(tools);
    // Build messages directly to avoid ChatPromptTemplate { } parsing issues
    const systemContent = systemPrompt + "\n\n" + toolDescription;

    let messages = [...state.messages];
    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;
      // Invoke model with direct message objects (no template parsing)
      const allMessages = [new SystemMessage(systemContent), ...messages];
      const response = await model.invoke(allMessages);
      const rawText = typeof response.content === "string" ? response.content : JSON.stringify(response.content);

      log.debug(`Ollama agent iteration ${iterations}, raw output: ${rawText.substring(0, 300)}`);

      const toolCall = parseToolCall(rawText, validToolNames);

      if (!toolCall || toolCall.tool === "FINAL_ANSWER") {
        // Final answer — return as the agent's response
        const answer = toolCall?.args?.answer || rawText.replace(/\{[^}]*"tool"[^}]*\}/g, "").trim() || rawText;
        messages.push(new AIMessage({ content: answer }));
        return { messages };
      }

      // Execute the tool
      const toolInstance = toolMap.get(toolCall.tool);
      if (!toolInstance) {
        log.warn(`Tool "${toolCall.tool}" not found. Available: ${validToolNames.join(", ")}`);
        messages.push(
          new AIMessage({ content: rawText }),
          new HumanMessage({
            content: `Tool "${toolCall.tool}" is not available. Available tools: ${validToolNames.join(", ")}. Please try again.`,
          }),
        );
        continue;
      }

      try {
        log.debug(`Invoking tool "${toolCall.tool}" with args: ${JSON.stringify(toolCall.args)}`);
        const toolResult = await toolInstance.invoke(toolCall.args);
        const resultStr = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult);

        log.debug(`Tool "${toolCall.tool}" result: ${resultStr.substring(0, 200)}`);

        // Feed tool result back to the model
        messages.push(
          new AIMessage({ content: rawText }),
          new HumanMessage({
            content: `Tool "${toolCall.tool}" returned:\n${resultStr}\n\nNow provide your final answer based on this data, or call another tool if needed. Remember to respond with ONLY a JSON object.`,
          }),
        );
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log.error(`Tool "${toolCall.tool}" error: ${errMsg}`);
        messages.push(
          new AIMessage({ content: rawText }),
          new HumanMessage({
            content: `Tool "${toolCall.tool}" failed with error: ${errMsg}. Please provide a response or try a different approach. Remember to respond with ONLY a JSON object.`,
          }),
        );
      }
    }

    // Max iterations reached
    messages.push(
      new AIMessage({
        content: "I've reached the maximum number of tool-calling steps. Here is what I gathered so far.",
      }),
    );
    return { messages };
  };

  // Build as a simple single-node StateGraph (compatible with LangGraph invoke pattern)
  return new StateGraph(MessagesAnnotation)
    .addNode("agent", agentNode)
    .addEdge("__start__", "agent")
    .addEdge("agent", "__end__")
    .compile();
}

/**
 * Checks if the given model name is in the list of supported Ollama models.
 * This is used to determine whether to use the Ollama React Agent or a standard tool-calling approach.
 * @param modelName - The name of the model to check
 * @returns true if it's a supported Ollama model, false otherwise
 */
export const isOllamaModel = (modelName: string) => {
  return (SUPPORTED_OLLAMA_MODELS as readonly string[]).includes(modelName);
};
