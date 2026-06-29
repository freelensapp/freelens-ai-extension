# @freelensapp/ai-extension

<!-- markdownlint-disable MD013 -->

[![Home](https://img.shields.io/badge/%F0%9F%8F%A0-freelens.app-02a7a0)](https://freelens.app)
[![GitHub](https://img.shields.io/github/stars/freelensapp/freelens-ai-extension?style=flat&label=GitHub%20%E2%AD%90)](https://github.com/freelensapp/freelens-ai-extension)
[![Release](https://img.shields.io/github/v/release/freelensapp/freelens-ai-extension?display_name=tag&sort=semver)](https://github.com/freelensapp/freelens-ai-extension)
[![Integration tests](https://github.com/freelensapp/freelens-ai-extension/actions/workflows/integration-tests.yaml/badge.svg?branch=main)](https://github.com/freelensapp/freelens-ai-extension/actions/workflows/integration-tests.yaml)
[![npm](https://img.shields.io/npm/v/@freelensapp/ai-extension.svg)](https://www.npmjs.com/package/@freelensapp/ai-extension)

Freelens AI is an extension for [Freelens](https://freelens.app) that brings
AI capabilities directly into your workflow.

With Freelens AI, you can harness the power of artificial intelligence to
automate complex tasks and enhance productivity.

## Video Demo

[Video Demo](https://github.com/user-attachments/assets/3463a056-ff83-4705-aa9a-cae3a5f63feb)

---

**Quick Links:**

- [Install](#install)
- [How to obtain a Google API Key](./docs/GOOGLE_API_KEY.md)
- [Build & Run Guide](./docs/BUILD.md)

---

## Index

- [@freelensapp/ai-extension](#freelensappai-extension)
  - [Index](#index)
  - [How it works](#how-it-works)
  - [Available Models](#available-models)
    - [Using other providers through an OpenAI-compatible gateway](#using-other-providers-through-an-openai-compatible-gateway)
    - [DeepSeek and other "thinking" models](#deepseek-and-other-thinking-models)
    - [Connecting a model](#connecting-a-model)
    - [Key Features](#key-features)
    - [Base Agent](#base-agent)
    - [MCP Agent](#mcp-agent)

---
## Install
Open freelens > file > extensions and add the folowing string to the textbox: **@freelensapp/ai-extension**

or:

Use a following URL in the browser:
[freelens://app/extensions/install/%40freelensapp%2Fai-extension](freelens://app/extensions/install/%40freelensapp%2Fai-extension)

## How it works

Freelens AI is a **client of a large language model API**. It does not run a
model itself; instead it sends your prompts and the cluster context to a model
provider and renders the response. The agent logic (the LangGraph supervisor,
the cluster tools, structured output, and human-in-the-loop approvals) runs
inside the extension, and only the model inference is delegated to the provider.

- **Talks the OpenAI Chat Completions API.** The extension is built on the
  OpenAI client and the OpenAI-compatible wire format. It works with OpenAI
  directly, and with any endpoint that implements the same API — either natively
  or through an OpenAI-compatible gateway such as
  [LiteLLM](https://github.com/BerriAI/litellm) (see [Using other providers
  through an OpenAI-compatible
  gateway](#using-other-providers-through-an-openai-compatible-gateway)).
- **Pay-as-you-go billing.** You bring your own API key, and the provider bills
  you per token for the requests the extension makes. There is no bundled
  subscription or hosted backend; usage cost depends entirely on the model and
  provider you configure.
- **Requires standard API access.** Because the extension drives the model
  through the OpenAI-compatible API and its own tool/structured-output protocol,
  it can only use providers that expose such an API with a standard API key.

### What the extension cannot use

Some providers do **not** offer a general-purpose, pay-as-you-go API key.
Instead they grant access **only** through their own native tooling and a
custom, proprietary SDK — for example **Claude Code**, which authenticates with
a subscription token obtained via `claude login` / `claude setup-token` and is
designed to be driven exclusively by Anthropic's own runtime and Agent SDK.

These providers are **not compatible** with this extension:

- The access is tied to a **subscription/native client**, not a standard
  pay-as-you-go API key, and reusing those tokens in a third-party app is
  outside the provider's terms.
- They expose their own **agent loop, tools, and SDK** rather than the
  OpenAI-compatible Chat Completions API and tool protocol the extension relies
  on, so they cannot be plugged in behind the existing provider/proxy.

If you want to use such a provider, run it through its own dedicated client. To
use it with Freelens AI you would need an OpenAI-compatible endpoint and a
standard API key (directly or through a gateway).

## Available Models
The list of models is fully editable in the extension preferences. You can add
or remove any model offered by the configured provider; the model name you enter
is sent directly to the provider API.

The list comes seeded with these OpenAI models, which you can change at any time:

- ***gpt-5.5***
- ***gpt-5.4***
- ***gpt-5.4-mini***

Model-specific behavior (for example, sending a reasoning effort instead of a
temperature) is decided by heuristics on the model name, so adding a new model
needs no code changes.

> Currently the **OpenAI** provider is the only one enabled. Google/Gemini
> support is temporarily disabled and will return after further refactoring.

### Using other providers through an OpenAI-compatible gateway
Although OpenAI is the only built-in provider, the extension talks to any
endpoint that implements the OpenAI Chat Completions API. That means you can put
a gateway such as [LiteLLM](https://github.com/BerriAI/litellm) in front of the
extension and reach providers like Anthropic, Google/Gemini, DeepSeek, Qwen, and
many others through a single OpenAI-compatible API.

To do this, set the **Base URL** in the OpenAI section of the preferences to your
gateway (for example `http://localhost:4000/v1`) and use the model names exposed
by that gateway. Requests are routed through the extension's local proxy, so the
custom base URL works without any code changes.

### DeepSeek and other "thinking" models
Some models reached through a gateway need extra handling, which the extension
applies automatically based on the model name:

- **DSML tool-call markup**: DeepSeek models emit native tool calls in their
  "DSML" markup. OpenAI-compatible endpoints without a server-side tool-call
  parser leak this markup into the assistant text instead of returning
  structured tool calls. For these models the extension uses a client that
  recovers the tool calls from the markup so tools still run.
- **Forced tool choice**: DeepSeek and Qwen reasoning models reject a *forced*
  `tool_choice` while thinking mode is on; the extension requests
  `tool_choice: "auto"` for them instead.
- **Disable thinking mode**: some providers (for example DeepSeek via LiteLLM)
  expose a thinking mode that conflicts with the forced tool selection used for
  structured output. If you hit a `Thinking mode does not support this
  tool_choice` error, enable **Disable thinking mode** in the OpenAI preferences.

### Connecting a model
Open the preferences page and, in the OpenAI section, set your API key and
(optionally) a custom base URL. You can also provide the key through an
environment variable instead:

- OPENAI_API_KEY = ...

A model is only offered in the chat dropdown once its provider has a key set; if
no model is available, the chat shows a button that takes you to the preferences
page.

---

### Key Features

Talk to your cluster in natural language. The agent reads, explains, and (with
your approval) changes Kubernetes resources, while the chat keeps the full
context of the conversation.

**Cluster operations through tools**

- **Any resource kind**: list, get, create, update, patch, and delete any
  Kubernetes resource — built-in kinds and CRDs alike — instead of a fixed set
  of Pod/Deployment/Service operations.
- **Pod logs**: read a snapshot of container logs, including the previous
  (terminated) instance for `CrashLoopBackOff`, with a regular-expression filter
  to narrow chatty logs to only the matching lines.
- **Smaller, focused output**: `metadata.managedFields` is stripped by default,
  and JSONPath-style field selectors (the `kubectl -o jsonpath` subset) let the
  agent fetch only the fields it needs.
- **In-place pod resize and scaling**: patch the `resize` subresource to change a
  running Pod's CPU/memory without recreating it (Kubernetes 1.33+), or `scale`
  to change replicas.
- **Delete and restart variants**: graceful pod eviction that honors
  PodDisruptionBudgets, force delete with a zero grace period, finalizer
  clearing for objects stuck in `Terminating`, and `rollout restart` for
  workloads.
- **Cluster insight**: query the Kubernetes server version and analyze warning
  events in a namespace with explanations and remedies.

**Safe, human-in-the-loop changes**

- **Approval gate**: every change is shown for review — rendered as YAML — and
  applied only after you approve it.
- **Backups**: the current state of a resource is presented before it is
  changed, so a modification can be reverted.

**Chat experience**

- **Persistent sessions**: the chat transcript and agent state are stored by the
  host and survive application restarts; an unsent prompt draft is kept across
  view switches.
- **Per-cluster context**: each cluster keeps its own separate conversation.
- **Token counter and cost estimate**: a live per-session token count and cost
  estimate sit next to the model list.
- **Automatic compaction**: long sessions are compacted before they reach the
  model's input-token limit so the conversation can continue.
- **Rich rendering**: code blocks use the host Monaco editor, GitHub-flavored
  Markdown tables are supported, and model reasoning is shown in a collapsible
  block.
- **Retry on errors**: failed messages can be retried with one click.

**Models and providers**

- **Editable model list** seeded with OpenAI models, with model-specific
  behavior chosen by name heuristics (see [Available
  Models](#available-models)).
- **OpenAI-compatible gateways** for reaching other providers, with built-in
  handling for DeepSeek and other "thinking" models.
- **Custom agent rules** can be added from the preferences to steer the agent.

**Security**

- The API key is injected in the main process rather than the renderer, the
  local AI proxy requires a per-launch bearer token, and CORS is restricted.

### Base Agent

We have a base multi agent system that processes user prompts with a set of
basic tools to get started. Go deeper by reading our [Base Agent
documentation](docs/BASE_AGENT.md).

### MCP Agent

We support MCP Agent through a dedicated configuration. Go deeper by reading
our [MCP Agent documentation](docs/MCP_AGENT.md).

---

#### Additional Resources

- [***Contribute***](CONTRIBUTING.md)
- [***Build freelens-ai-extension extension***](./docs/BUILD.md)
- [***Set up extension on freelens***](./docs/SET_UP_EXTENSION.md)

If you find this project useful, please consider giving it a ⭐️ on
[***GitHub***](https://github.com/freelensapp/freelens-ai)!
