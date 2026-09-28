# DeepSeek DSML tool-call recovery (removed)

This page records a feature that was removed during the migration from
LangGraph to the Strands Agents SDK (issue #284, decision "E1"). It explains
what the feature did, who is affected by its absence, and how to add it back on
top of the Strands agent.

## What it did

A model asks for a tool by emitting special tokens. The server running the
model (vLLM, SGLang, LiteLLM, the official API) is expected to turn those tokens
into the structured OpenAI `tool_calls` field. DeepSeek's native tool-call
format is called "DSML":

```text
<｜｜DSML｜｜tool_calls>
  <｜｜DSML｜｜invoke name="listKubernetesResources">
    <｜｜DSML｜｜parameter name="kind" string="true">Pod</｜｜DSML｜｜parameter>
  </｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>
```

The bars are fullwidth characters (U+FF5C). A parameter marked
`string="true"` is a literal string; any other value is JSON.

When DeepSeek is self-hosted without a tool-call parser (for example vLLM
without `--enable-auto-tool-choice --tool-call-parser deepseek_v3`), this markup
comes back as plain assistant text and `tool_calls` is empty. The LangGraph
version of the extension handled this in two ways:

1. **Recovery**: for models whose name matched `/deepseek/i`, it buffered the
   whole streamed answer, parsed the DSML markup into real tool calls and
   removed the markup from the text. The tools, including approvals, then ran
   as usual. DeepSeek answers were therefore not streamed token by token.
2. **Detection**: if markup leaked but could not be parsed (for example the
   native `<｜tool▁calls▁begin｜>` token format, which carries no arguments), the
   agent stopped with an explanatory message instead of showing raw markup.

A related check, `findUnknownToolCalls`, stopped the agent with a clear message
when the model called a tool that does not exist (for example a made-up
`runCommand` shell tool).

## Current behavior

Without this code, a DeepSeek model behind an endpoint that has no tool-call
parser returns the DSML markup as chat text. No tool runs, no approval prompt
appears and no explanation is shown. The official DeepSeek API and correctly
configured vLLM, SGLang or LiteLLM deployments return real `tool_calls` and are
not affected. The recommended fix is on the server side: enable the tool-call
parser.

A call to an unknown tool now gets the Strands SDK's standard "tool not found"
result, and the model writes its own reply.

## Where the old code is

The last release with the feature is `v0.7.1` (commit `35136a2`). The relevant
files there are:

| File | Content |
| --- | --- |
| `src/renderer/business/agent/leaked-tool-calls.ts` | `containsLeakedToolCallMarkup`, `parseDsmlToolCalls`, `recoverDsmlToolCalls`, `findUnknownToolCalls`, the user-facing messages |
| `src/renderer/business/agent/leaked-tool-calls.test.ts` | Parser and detection tests, with real markup samples |
| `src/renderer/business/provider/dsml-aware-chat-model.ts` | `DsmlAwareChatOpenAI`, the LangChain model that buffered the stream and applied the recovery |
| `src/renderer/business/provider/dsml-aware-chat-model.test.ts` | Tests for the buffering model |
| `src/renderer/business/provider/model-capabilities.ts` | `emitsDsmlToolCalls` (the `/deepseek/i` name pattern) |
| `src/renderer/business/agent/freelens-agent-system.ts` | Where the detection checks stopped the agent |

To view or restore a file:

```bash
git show v0.7.1:src/renderer/business/agent/leaked-tool-calls.ts
git show v0.7.1:src/renderer/business/agent/leaked-tool-calls.test.ts
```

Only the LangChain wrapper code is tied to the old stack. The regular
expressions and the parser logic in `parseDsmlToolCalls` work on plain strings
and can be reused as they are once the LangChain types are removed (see below).

## How to add it back

Pick the level that is needed. Level 1 is small and does not depend on SDK
internals. Level 2 restores the old behavior exactly.

### Step 0: bring back the pure helpers

1. Restore `leaked-tool-calls.ts` and its test from `v0.7.1` into
   `src/renderer/business/agent/`.
2. Remove the `@langchain/core` imports:
   - replace `MessageContent` with `string` and drop the `toText` helper, or
     keep a small version that joins the Strands text blocks
     (`{ type: "textBlock", text }`) of a message;
   - replace LangChain's `ToolCall` with a local type:
     `{ name: string; args: Record<string, unknown>; id: string }`;
   - delete `recoverDsmlToolCalls` and `messageContentToText`, which build and
     read LangChain `AIMessage` objects.
3. Restore `emitsDsmlToolCalls` in `model-capabilities.ts`, with its test.
4. Adapt the restored test to the string-based signatures and run
   `pnpm test:unit`.

### Level 1: detection only

Report a clear error instead of showing raw markup. Streaming is unchanged for
every model.

In the stream adapter (`src/renderer/business/service/strands-stream.ts`), or
after the agent run in `agent-service.ts`, collect the text of the final
assistant message. If `containsLeakedToolCallMarkup(text)` is true, replace the
answer with `LEAKED_TOOL_CALL_MESSAGE`.

For the unknown-tool message, check the tool names requested in the assistant
message (`toolUseBlock` content blocks) against the names of the tools given to
the agent in `freelens-agent.ts`. If any is unknown, show
`buildUnsupportedToolCallMessage(names)`. Alternatively, register a Strands hook
that runs before each tool call and cancels calls to unknown tools with that
message.

### Level 2: full recovery

Wrap the Strands `OpenAIModel` so the DSML markup is turned into real tool-use
events before the agent loop sees them. The agent then runs the tools and the
approval prompts exactly as for a model that returns structured `tool_calls`.

1. Create `src/renderer/business/provider/dsml-aware-openai-model.ts` with a
   class that extends `OpenAIModel` from `@strands-agents/sdk/models/openai`
   and overrides `stream(messages, options)`:
   - Iterate `super.stream(messages, options)` and buffer every event.
   - Accumulate the text from `modelContentBlockDeltaEvent` events whose
     `delta.type` is `"textDelta"`.
   - Pass `reasoningContentDelta` deltas through immediately so the reasoning
     still streams live.
   - When the stream ends, if a `toolUseStart` block was already seen, or the
     text has no DSML `invoke` block, re-yield the buffered events unchanged.
   - Otherwise call `parseDsmlToolCalls(text)` and yield a new sequence:
     1. the original `modelMessageStartEvent`;
     2. if `cleanedText` is not empty, one text block (a delta with
        `{ type: "textDelta", text: cleanedText }` followed by
        `modelContentBlockStopEvent`);
     3. for each recovered call, a `modelContentBlockStartEvent` with
        `start: { type: "toolUseStart", name, toolUseId }`, a
        `modelContentBlockDeltaEvent` with
        `delta: { type: "toolUseInputDelta", input: JSON.stringify(args) }` and a
        `modelContentBlockStopEvent`;
     4. a `modelMessageStopEvent` with `stopReason: "toolUse"`;
     5. the original `modelMetadataEvent` (token usage), if any.
   - Use a unique `toolUseId` per call (for example `dsml_tool_call_<n>`
     plus a random suffix), because tool results are matched to calls by id.
2. In `createStrandsOpenAIModel` (`strands-openai-model.ts`), build this class
   instead of `OpenAIModel` when `emitsDsmlToolCalls(modelName)` is true. Keep
   the reasoning tap: pass the tapped `client` to the new class the same way.
3. Keep the Level 1 detection as a fallback for markup that cannot be parsed.
4. Add tests with a scripted fake model stream, in the same style as
   `src/renderer/business/agent/freelens-agent.test.ts`. Cover a DSML answer
   that runs a read tool, a DSML answer that asks for approval, and an answer
   with no markup that must pass through unchanged.

The event names and fields above match `@strands-agents/sdk` 1.19.0
(`dist/src/models/streaming.d.ts`). The SDK is still marked experimental, so
check that file again after an upgrade.

Buffering means DeepSeek answers arrive all at once instead of token by token,
as before the migration. Only models matching `emitsDsmlToolCalls` pay this
cost.

### Checks before committing

```bash
pnpm lint:fix && pnpm type:check && pnpm test:unit && pnpm build
```

Then update the "DeepSeek and other thinking models" section of the README,
which currently says the markup is no longer recovered.
