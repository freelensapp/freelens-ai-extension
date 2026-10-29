# @freelensapp/ai-extension

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

[Video Demo](https://github.com/user-attachments/assets/1307de5c-5bd3-431d-a5b4-c9ea46be2e66)

---

**Quick Links:**

- [Install](#install)
- [How to obtain a Google API Key](./docs/GOOGLE_API_KEY.md) (provider
  temporarily disabled)
- [Build from the source](#build-from-the-source)

---

## Index

- [@freelensapp/ai-extension](#freelensappai-extension)
  - [Video Demo](#video-demo)
  - [Index](#index)
  - [Requirements](#requirements)
  - [Install](#install)
    - [From the registry](#from-the-registry)
    - [From a release tarball](#from-a-release-tarball)
    - [From a directory](#from-a-directory)
  - [How it works](#how-it-works)
    - [What the extension cannot use](#what-the-extension-cannot-use)
  - [Available Models](#available-models)
    - [Using other providers through an OpenAI-compatible gateway](#using-other-providers-through-an-openai-compatible-gateway)
    - [DeepSeek and other "thinking" models](#deepseek-and-other-thinking-models)
    - [Ollama](#ollama)
    - [Connecting a model](#connecting-a-model)
    - [Key Features](#key-features)
    - [Base Agent](#base-agent)
    - [MCP Agent](#mcp-agent)
  - [Build from the source](#build-from-the-source)
    - [Prerequisites](#prerequisites)
    - [Build the extension](#build-the-extension)
    - [Development loop](#development-loop)
    - [Check the code](#check-the-code)
  - [Additional Resources](#additional-resources)

---

## Requirements

- Freelens >= 2.0.0
- An API key of OpenAI, or of an endpoint that implements the OpenAI Chat
  Completions API (see [How it works](#how-it-works))

## Install

Open Freelens and go to Extensions (`ctrl`+`shift`+`E` or
`cmd`+`shift`+`E`). The field at the top takes a package name, the URL of a
tarball, or the path to a tarball or a directory.

### From the registry

Enter `@freelensapp/ai-extension` and press Install.

Alternatively, open the following URL in the browser to install directly:

[freelens://app/extensions/install/%40freelensapp%2Fai-extension](freelens://app/extensions/install/%40freelensapp%2Fai-extension)

### From a release tarball

Each [release](https://github.com/freelensapp/freelens-ai-extension/releases)
has the extension as `freelensapp-ai-extension-<version>.tgz`, with its
checksum in `freelensapp-ai-extension-<version>.tgz.sha256`. Use a release
whose major version matches your Freelens version: the 1.x releases are for
Freelens 2, the 0.x releases for Freelens 1.

- Enter the URL of the `.tgz` asset and press Install. Freelens downloads the
  `.tgz.sha256` next to it and checks the tarball against it.
- Or download both files into one directory and enter the path to the `.tgz`,
  or drop the `.tgz` on the Freelens window. Freelens checks it against the
  `.tgz.sha256` next to it.

### From a directory

[Build the extension](#build-the-extension), then enter the path to your
checkout, the directory with `package.json`, and press Install. Freelens runs
the extension from that directory, from the files in `dist/`, and lists it as
unverified. This is how you work on the extension: see
[Development loop](#development-loop).

Once installed, set the API key in the extension's preferences, as described
in [Connecting a model](#connecting-a-model) and, with screenshots, in the
[set up guide](./docs/SET_UP_EXTENSION.md).

## How it works

Freelens AI is a **client of a large language model API**. It does not run a
model itself; instead it sends your prompts and the cluster context to a model
provider and renders the response. The agent logic (the LangGraph supervisor,
the cluster tools, structured output, and human-in-the-loop approvals) runs
inside the extension, in the main process of Freelens, and only the model
inference is delegated to the provider.

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

- _**gpt-5.5**_
- _**gpt-5.4**_
- _**gpt-5.4-mini**_

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
by that gateway. The requests are sent by the main process of Freelens, so the
proxy and certificate settings of the Freelens preferences apply to them.

### DeepSeek and other "thinking" models

Some models reached through a gateway need extra handling, which the extension
applies automatically based on the model name:

- **DSML tool-call markup**: DeepSeek models emit native tool calls in their
  "DSML" markup. OpenAI-compatible endpoints without a server-side tool-call
  parser leak this markup into the assistant text instead of returning
  structured tool calls. For these models the extension uses a client that
  recovers the tool calls from the markup so tools still run.
- **Forced tool choice**: DeepSeek and Qwen reasoning models reject a _forced_
  `tool_choice` while thinking mode is on; the extension requests
  `tool_choice: "auto"` for them instead.
- **Disable thinking mode**: some providers (for example DeepSeek via LiteLLM)
  expose a thinking mode that conflicts with the forced tool selection used for
  structured output. If you hit a `Thinking mode does not support this
  tool_choice` error, enable **Disable thinking mode** in the OpenAI preferences.

### Ollama

[Ollama](https://ollama.com) exposes a natively OpenAI-compatible endpoint, so
no gateway is needed to reach a model running on your own machine.

To connect it:

- Set the **Base URL** in the OpenAI section of the preferences to
  `http://localhost:11434/v1`.
- Set any non-empty **API key**. Ollama ignores its value, but a key must be set
  for the models to appear in the chat.
- Add the exact model name, **including its tag** (for example `llama3.2:3b`, as
  shown by `ollama list`), to the editable model list.

The model must support **tool calling**: the agent drives every cluster
operation through tools, so a model without tool support cannot be used. Models
with a "thinking" mode may need the handling described in [DeepSeek and other
"thinking" models](#deepseek-and-other-thinking-models).

No pricing data is available for local models, so the cost estimate stays hidden
and only the token counter is shown.

On networks with TLS inspection, the first `ollama pull` may need the corporate
root certificate to be trusted by Ollama's environment.

### Connecting a model

Open the preferences page and, in the OpenAI section, set your API key and
(optionally) a custom base URL. You can also provide the key through an
environment variable of the Freelens process instead, which takes precedence
over the key of the preferences:

- OPENAI_API_KEY = ...

A model is only offered in the chat dropdown once its provider has a key set; if
no model is available, the chat shows a button that takes you to the preferences
page.

The **Base URL** is a single global setting: every configured model is requested
from that endpoint, so switching between a cloud provider and a local one means
changing the Base URL. If you alternate between them regularly, put a gateway
such as [LiteLLM](https://github.com/BerriAI/litellm) in front of the extension
and keep one fixed URL, with the models routed by name.

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
- **Explain an event**: the menu of a warning Event has an "Explain" item,
  which opens the chat with an analysis of the event.

**Models and providers**

- **Editable model list** seeded with OpenAI models, with model-specific
  behavior chosen by name heuristics (see [Available
  Models](#available-models)).
- **OpenAI-compatible gateways** for reaching other providers, with built-in
  handling for DeepSeek and other "thinking" models.
- **Custom agent rules** can be added from the preferences to steer the agent.

**Security**

- The agents and the model client run in the main process of Freelens, and the
  API key never leaves it. The chat talks to them over a local bridge on
  `127.0.0.1`, which refuses every request without its per-launch token.
- Each cluster's chat acts on that cluster only, through Freelens.

### Base Agent

We have a base multi agent system that processes user prompts with a set of
basic tools to get started. Go deeper by reading our [Base Agent
documentation](docs/BASE_AGENT.md).

### MCP Agent

We support MCP Agent through a dedicated configuration. The MCP servers run in
the main process of Freelens, one set per cluster, and reach the cluster the
chat is open for through Freelens. Go deeper by reading our
[MCP Agent documentation](docs/MCP_AGENT.md).

---

## Build from the source

### Prerequisites

Use [NVM](https://github.com/nvm-sh/nvm),
[mise-en-place](https://mise.jdx.dev/), or
[windows-nvm](https://github.com/coreybutler/nvm-windows) to install the
Node.js version in `.nvmrc`.

From the root of this repository:

```sh
nvm install
# or
mise install
# or
winget install CoreyButler.NVMforWindows
nvm install "$(cat .nvmrc)"
nvm use "$(cat .nvmrc)"
```

Install pnpm:

```sh
corepack install
# or
curl -fsSL https://get.pnpm.io/install.sh | sh -
# or
winget install pnpm.pnpm
```

### Build the extension

```sh
pnpm install
pnpm build
```

The extension is built into `dist/`. To pack it into a tarball:

```sh
pnpm pack
```

One script to bump the prerelease version, build and pack the extension for
testing:

```sh
pnpm pack:dev
```

The tarball is placed in the current directory. Install it as described in
[From a release tarball](#from-a-release-tarball).

### Development loop

Install the extension from your checkout once, as described in
[From a directory](#from-a-directory), then run:

```sh
pnpm dev
```

It rebuilds the extension whenever a source file changes, and Freelens
reloads the extension after each rebuild, without a restart and without
packing. Stop it with `ctrl`+`C`.

Neither `pnpm build` nor `pnpm dev` type-checks; run `pnpm type:check` for
that. A change to `main` or `renderer` in `package.json` needs Freelens
restarted once.

### Check the code

```sh
pnpm type:check
pnpm test:unit
pnpm lint:check
pnpm build
pnpm knip:check
```

and, for the formats that Biome does not cover (TOML, shell scripts, workflows):

```sh
pnpm trunk:check
```

### Integration tests

The integration tests drive Freelens dev, started from a
[freelensapp/freelens](https://github.com/freelensapp/freelens) checkout,
against a [kind](https://kind.sigs.k8s.io/) cluster. In the Freelens checkout:

```sh
pnpm dev
```

Freelens dev lists no cluster until a kubeconfig is added in Preferences >
Kubernetes > Kubeconfig Syncs. Add one with the kind cluster, for example:

```sh
kubectl config view --minify --flatten --context kind-kind > ~/kind-kind.kubeconfig
```

Then, with the kind cluster running, in the extension repository:

```sh
pnpm build
pnpm test:integration
```

The tests install the checkout in place, replacing any other installation of
the extension in Freelens dev. They create the namespace `integration-tests`
with a Warning event, and delete it afterwards. They clear the chat of the
kind cluster and set the API key, the base URL and the model in the
extension's preferences. Without Freelens dev or the cluster the tests are
skipped.

Two prompts, one in the chat and one from "Explain", are sent to a model
endpoint given by three variables, in the environment or in a `.env` file of
the repository:

```sh
LLM_API_URL=http://localhost:4000
LLM_API_KEY=sk-...
LLM_API_MODEL=gpt-5.4-mini
```

Without them the prompts are skipped and the API key is left empty.

Optional variables:

- `TEST_KIND_CLUSTER_NAME`: the kind cluster, `kind` by default, used
  through the context `kind-<name>`.
- `FREELENS_CDP_URL`: the CDP endpoint of Freelens dev,
  `http://127.0.0.1:9223` by default.
- `FREELENS_MAIN_LOG`: a log of the main process to check for errors, such
  as its `lens.log`. Without it only the renderer's errors are checked.

How the extension is built, type-checked and tested, and why, is described in
[AGENTS.md](AGENTS.md).

## Additional Resources

- [**_Contribute_**](CONTRIBUTING.md)
- [**_Build the extension_**](./docs/BUILD.md)
- [**_Set up the extension in Freelens_**](./docs/SET_UP_EXTENSION.md)

If you find this project useful, please consider giving it a star on
[**_GitHub_**](https://github.com/freelensapp/freelens-ai-extension)!

## License

Copyright (c) 2025-2026 Freelens Authors.

[MIT License](https://opensource.org/licenses/MIT)
