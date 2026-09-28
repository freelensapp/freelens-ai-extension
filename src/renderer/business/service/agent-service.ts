import { redactSecrets } from "../../../common/utils/redact";
import { abandonPendingApprovals, buildResumeArgs } from "../agent/freelens-agent";
import { approximateMessagesTokenCount } from "../provider/token-estimate";
import {
  type AgentChunk,
  createStrandsStreamState,
  interleaveSideChannel,
  mapAgentStreamEvent,
  SideChannel,
} from "./strands-stream";

import type { Agent, InvokeArgs, Model } from "@strands-agents/sdk";

export {
  type AgentChunk,
  type ApprovalChunk,
  type ContextSizeChunk,
  isApprovalChunk,
  isContextSizeChunk,
  isReasoningChunk,
  isTokenUsageChunk,
  type ReasoningChunk,
  type TokenUsageChunk,
} from "./strands-stream";

// What to send to the agent: a new user prompt, or the answer ("yes"/"no") to
// the pending tool approval.
export type AgentInput = { kind: "message"; text: string } | { kind: "resume"; answer: string };

// Builds the model for a run, wiring the reasoning deltas it streams.
export type ModelFactory = (onReasoning: (text: string) => void) => Model;

export interface AgentService {
  run(input: AgentInput): AsyncGenerator<AgentChunk, void, unknown>;
}

/**
 * This service runs the single Freelens agent and streams its response back to
 * the caller as UI chunks, including the approval requests that pause it.
 *
 * Transient model errors (throttling, overload) are retried by the Strands
 * default retry strategy inside the agent loop.
 */
export const useAgentService = (agent: Agent, buildModel: ModelFactory): AgentService => {
  const run = async function* (input: AgentInput) {
    console.log("Starting Agent Service run for input: ", redactSecrets(input));
    // Restore the persisted session (conversation + pending approvals) before
    // deciding how to feed the input.
    await agent.initialize();

    let args: InvokeArgs;
    if (input.kind === "resume") {
      const resumeArgs = buildResumeArgs(agent, input.answer);
      if (!resumeArgs) {
        console.log("No pending approval to resume, ignoring answer: ", input.answer);
        return;
      }
      args = resumeArgs;
    } else {
      // A new prompt while an approval is pending means the user moved on
      // without answering it: drop the paused tool call and continue.
      abandonPendingApprovals(agent);
      args = input.text;
    }

    // Rebuild the model per run so a model or endpoint change in the
    // preferences applies to the next prompt. Its reasoning deltas are fed
    // through a side channel and interleaved with the agent stream.
    const reasoning = new SideChannel<string>();
    agent.model = buildModel((text) => reasoning.push(text));

    const state = createStrandsStreamState();
    for await (const item of interleaveSideChannel(agent.stream(args), reasoning)) {
      if ("side" in item) {
        yield { reasoning: item.side };
        continue;
      }
      yield* mapAgentStreamEvent(state, item.source);
    }

    // Providers that report no token usage still get a capacity reading,
    // estimated from the conversation text (~4 chars/token).
    if (!state.sawUsage) {
      yield { contextTokens: approximateMessagesTokenCount(agent.messages), peakInputTokens: 0 };
    }
  };

  return { run };
};
