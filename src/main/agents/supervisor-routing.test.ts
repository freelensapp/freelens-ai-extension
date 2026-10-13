import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import {
  END_DESTINATION,
  recoverSupervisorRouting,
  routingFromText,
  routingFromToolCall,
  SUPERVISOR_TOOL_NAME,
} from "./supervisor-routing";

const subAgents = ["agentAnalyzer", "kubernetesOperator", "generalPurposeAgent"];
const destinations = [END_DESTINATION, ...subAgents];

const toolCallMessage = (args: Record<string, unknown>) =>
  new AIMessage({
    content: "",
    tool_calls: [{ name: SUPERVISOR_TOOL_NAME, args, id: "call_1", type: "tool_call" }],
  });

describe("routingFromToolCall", () => {
  it("extracts a valid structured routing decision", () => {
    const message = toolCallMessage({ reflection: "All done", goto: END_DESTINATION });
    expect(routingFromToolCall(message, destinations)).toEqual({ reflection: "All done", goto: END_DESTINATION });
  });

  it("defaults reflection to an empty string when missing", () => {
    const message = toolCallMessage({ goto: "agentAnalyzer" });
    expect(routingFromToolCall(message, destinations)).toEqual({ reflection: "", goto: "agentAnalyzer" });
  });

  it("returns undefined when goto is not a known destination", () => {
    const message = toolCallMessage({ reflection: "x", goto: "someAgent" });
    expect(routingFromToolCall(message, destinations)).toBeUndefined();
  });

  it("returns undefined when there is no extract tool call", () => {
    expect(routingFromToolCall(new AIMessage({ content: "no tools here" }), destinations)).toBeUndefined();
  });
});

describe("routingFromText", () => {
  it("routes to __end__ when the model answered in plain text with the sentinel", () => {
    const message = new AIMessage({ content: "The user's query has been resolved. __end__" });
    expect(routingFromText(message, subAgents)).toEqual({
      reflection: "The user's query has been resolved. __end__",
      goto: END_DESTINATION,
    });
  });

  it("routes to a sub-agent named in the text", () => {
    const message = new AIMessage({ content: "We still need cluster state, route to agentAnalyzer next." });
    expect(routingFromText(message, subAgents)).toEqual({
      reflection: "We still need cluster state, route to agentAnalyzer next.",
      goto: "agentAnalyzer",
    });
  });

  it("defaults to __end__ when the model produced a final answer with no destination", () => {
    const message = new AIMessage({ content: "The deployment has 3 healthy replicas." });
    expect(routingFromText(message, subAgents)).toEqual({
      reflection: "The deployment has 3 healthy replicas.",
      goto: END_DESTINATION,
    });
  });

  it("returns undefined for leaked tool-call markup so the caller can surface the parser error", () => {
    const message = new AIMessage({
      content: '<｜｜DSML｜｜invoke name="listKubernetesResources"></｜｜DSML｜｜invoke>',
    });
    expect(routingFromText(message, subAgents)).toBeUndefined();
  });

  it("returns undefined for empty text", () => {
    expect(routingFromText(new AIMessage({ content: "" }), subAgents)).toBeUndefined();
  });
});

describe("recoverSupervisorRouting", () => {
  it("prefers the structured tool call over the text fallback", () => {
    const message = new AIMessage({
      content: "agentAnalyzer should run",
      tool_calls: [
        {
          name: SUPERVISOR_TOOL_NAME,
          args: { reflection: "done", goto: END_DESTINATION },
          id: "c1",
          type: "tool_call",
        },
      ],
    });
    expect(recoverSupervisorRouting(message, destinations, subAgents)).toEqual({
      reflection: "done",
      goto: END_DESTINATION,
    });
  });

  it("falls back to the text routing when no usable tool call is present", () => {
    const message = new AIMessage({ content: "Everything looks healthy, __end__" });
    expect(recoverSupervisorRouting(message, destinations, subAgents)).toEqual({
      reflection: "Everything looks healthy, __end__",
      goto: END_DESTINATION,
    });
  });

  it("returns undefined when markup leaked and no tool call was parsed", () => {
    const message = new AIMessage({ content: "<｜tool▁calls▁begin｜>" });
    expect(recoverSupervisorRouting(message, destinations, subAgents)).toBeUndefined();
  });
});
