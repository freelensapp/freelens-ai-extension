# Where the agent runs

Type: grilling
Status: resolved
Blocked by:

## Question

Does the agent run in the renderer with `pi-agent-core` + `pi-ai`, or in the
main process with the `pi-coding-agent` SDK and an IPC bridge to the renderer?

## Answer

Main process with the `pi-coding-agent` SDK (option b). Resolved by
leo-capvano in PR #290, grilling round 1.

Why: pi was chosen to get its features already implemented and maintained.
Sessions, compaction, the extension runner (later MCP and sub-agents), all
providers, OAuth and custom providers live in `pi-coding-agent`, which is
Node-only (`docs/PI_AGENT_SDK_RESEARCH.md`, Q1). API keys already live in main
today.

Consequences:

- An IPC bridge streams agent events to the renderer chat UI and carries
  approvals back.
- The tools today depend on `Renderer.K8sApi` and `Renderer.Catalog`, which do
  not exist in main. See [Where cluster tools execute](08-where-cluster-tools-execute.md).
- Still to be confirmed by
  [Spike: pi-coding-agent in Freelens main](06-spike-pi-in-main.md) before the
  spec locks it in.

Hard to reverse: record as an ADR when the spike confirms it.
