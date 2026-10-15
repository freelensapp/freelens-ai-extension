import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import {
  buildUnsupportedToolCallMessage,
  containsLeakedToolCallMarkup,
  findUnknownToolCalls,
  parseDsmlToolCalls,
  recoverDsmlToolCalls,
} from "./leaked-tool-calls";

describe("containsLeakedToolCallMarkup", () => {
  it("detects leaked DSML tool_calls markup", () => {
    const content =
      'OK, I\'m getting Kustomization directly.<｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="listKubernetesResources"> ' +
      '<｜｜DSML｜｜parameter name="kind" string="true">Kustomization</｜｜DSML｜｜parameter> </｜｜DSML｜｜invoke> </｜｜DSML｜｜tool_calls>';
    expect(containsLeakedToolCallMarkup(content)).toBe(true);
  });

  it("detects DeepSeek native tool-call tokens", () => {
    expect(containsLeakedToolCallMarkup("<｜tool▁calls▁begin｜>")).toBe(true);
  });

  it("detects leaked markup inside array content parts", () => {
    const content = [
      { type: "text", text: "Sure, let me look that up. " },
      { type: "text", text: '<｜｜DSML｜｜invoke name="getKubernetesResource">' },
    ];
    expect(containsLeakedToolCallMarkup(content)).toBe(true);
  });

  it("returns false for normal assistant text", () => {
    expect(containsLeakedToolCallMarkup("The pod uses the image nginx:1.27.")).toBe(false);
  });

  it("returns false for empty content", () => {
    expect(containsLeakedToolCallMarkup("")).toBe(false);
    expect(containsLeakedToolCallMarkup([])).toBe(false);
  });

  it("does not flag the literal word DSML in prose", () => {
    expect(containsLeakedToolCallMarkup("DSML stands for domain-specific markup language.")).toBe(false);
  });
});

describe("parseDsmlToolCalls", () => {
  it("parses a single DSML tool call with a string parameter", () => {
    const content =
      'OK, listing them.<｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="listKubernetesResources"> ' +
      '<｜｜DSML｜｜parameter name="kind" string="true">Kustomization</｜｜DSML｜｜parameter> ' +
      "</｜｜DSML｜｜invoke> </｜｜DSML｜｜tool_calls>";
    const { cleanedText, toolCalls } = parseDsmlToolCalls(content);

    expect(cleanedText).toBe("OK, listing them.");
    expect(toolCalls).toEqual([
      { name: "listKubernetesResources", args: { kind: "Kustomization" }, id: "dsml_tool_call_0", type: "tool_call" },
    ]);
  });

  it("parses non-string parameters as JSON (objects, numbers)", () => {
    const content =
      '<｜｜DSML｜｜invoke name="updateKubernetesResource">' +
      '<｜｜DSML｜｜parameter name="name" string="true">my-app</｜｜DSML｜｜parameter>' +
      '<｜｜DSML｜｜parameter name="replicas">3</｜｜DSML｜｜parameter>' +
      '<｜｜DSML｜｜parameter name="data">{"spec":{"replicas":3}}</｜｜DSML｜｜parameter>' +
      "</｜｜DSML｜｜invoke>";
    const { toolCalls } = parseDsmlToolCalls(content);

    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      name: "updateKubernetesResource",
      args: { name: "my-app", replicas: 3, data: { spec: { replicas: 3 } } },
    });
  });

  it("parses multiple invoke blocks", () => {
    const content =
      '<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="getNamespaces"></｜｜DSML｜｜invoke>' +
      '<｜｜DSML｜｜invoke name="getKubernetesResource">' +
      '<｜｜DSML｜｜parameter name="kind" string="true">Pod</｜｜DSML｜｜parameter>' +
      "</｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>";
    const { cleanedText, toolCalls } = parseDsmlToolCalls(content);

    expect(cleanedText).toBe("");
    expect(toolCalls.map((c) => c.name)).toEqual(["getNamespaces", "getKubernetesResource"]);
    expect(toolCalls[0].args).toEqual({});
    expect(toolCalls[1].args).toEqual({ kind: "Pod" });
  });

  it("returns no tool calls for plain text", () => {
    const { cleanedText, toolCalls } = parseDsmlToolCalls("The pod uses nginx:1.27.");
    expect(toolCalls).toEqual([]);
    expect(cleanedText).toBe("The pod uses nginx:1.27.");
  });

  it("returns no tool calls for the native token format (not recoverable)", () => {
    const { toolCalls } = parseDsmlToolCalls("<｜tool▁calls▁begin｜>");
    expect(toolCalls).toEqual([]);
  });
});

describe("recoverDsmlToolCalls", () => {
  it("recovers tool calls from an AIMessage and strips the markup", () => {
    const message = new AIMessage({
      content: 'Sure.<｜｜DSML｜｜invoke name="getNamespaces"></｜｜DSML｜｜invoke>',
    });
    const recovered = recoverDsmlToolCalls(message) as AIMessage;

    expect(recovered).not.toBe(message);
    expect(recovered.content).toBe("Sure.");
    expect(recovered.tool_calls).toEqual([
      { name: "getNamespaces", args: {}, id: "dsml_tool_call_0", type: "tool_call" },
    ]);
  });

  it("leaves a message that already has structured tool calls unchanged", () => {
    const message = new AIMessage({
      content: "",
      tool_calls: [{ name: "getNamespaces", args: {}, id: "real_0", type: "tool_call" }],
    });
    expect(recoverDsmlToolCalls(message)).toBe(message);
  });

  it("leaves a plain assistant message unchanged", () => {
    const message = new AIMessage({ content: "No tools needed here." });
    expect(recoverDsmlToolCalls(message)).toBe(message);
  });

  it("leaves non-AI messages unchanged", () => {
    const message = new HumanMessage({ content: '<｜｜DSML｜｜invoke name="getNamespaces"></｜｜DSML｜｜invoke>' });
    expect(recoverDsmlToolCalls(message)).toBe(message);
  });
});

describe("findUnknownToolCalls", () => {
  const knownToolNames = ["getNamespaces", "listKubernetesResources"];

  it("flags a hallucinated tool such as runCommand", () => {
    const message = new AIMessage({
      content: "",
      tool_calls: [{ name: "runCommand", args: { command: "kubectl get pods" }, id: "0", type: "tool_call" }],
    });
    expect(findUnknownToolCalls([message], knownToolNames)).toEqual(["runCommand"]);
  });

  it("returns nothing when every tool call is known", () => {
    const message = new AIMessage({
      content: "",
      tool_calls: [
        { name: "getNamespaces", args: {}, id: "0", type: "tool_call" },
        { name: "listKubernetesResources", args: { kind: "Pod" }, id: "1", type: "tool_call" },
      ],
    });
    expect(findUnknownToolCalls([message], knownToolNames)).toEqual([]);
  });

  it("de-duplicates and collects unknown names across messages", () => {
    const messages = [
      new AIMessage({ content: "", tool_calls: [{ name: "runCommand", args: {}, id: "0", type: "tool_call" }] }),
      new AIMessage({ content: "", tool_calls: [{ name: "getNamespaces", args: {}, id: "1", type: "tool_call" }] }),
      new AIMessage({ content: "", tool_calls: [{ name: "execShell", args: {}, id: "2", type: "tool_call" }] }),
      new AIMessage({ content: "", tool_calls: [{ name: "runCommand", args: {}, id: "3", type: "tool_call" }] }),
    ];
    expect(findUnknownToolCalls(messages, knownToolNames)).toEqual(["runCommand", "execShell"]);
  });

  it("ignores messages without tool calls and non-AI messages", () => {
    const messages = [
      new HumanMessage({ content: "redeploy the helm chart" }),
      new AIMessage({ content: "Sure, I can help." }),
    ];
    expect(findUnknownToolCalls(messages, knownToolNames)).toEqual([]);
  });
});

describe("buildUnsupportedToolCallMessage", () => {
  it("names a single unsupported tool", () => {
    const message = buildUnsupportedToolCallMessage(["runCommand"]);
    expect(message).toContain("an unsupported tool");
    expect(message).toContain("`runCommand`");
    expect(message).toContain("not supported yet");
  });

  it("names multiple unsupported tools", () => {
    const message = buildUnsupportedToolCallMessage(["runCommand", "execShell"]);
    expect(message).toContain("unsupported tools");
    expect(message).toContain("`runCommand`, `execShell`");
  });
});
