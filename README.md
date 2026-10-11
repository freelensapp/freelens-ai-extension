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

[Video Demo](https://github.com/user-attachments/assets/1307de5c-5bd3-431d-a5b4-c9ea46be2e66)

---

**Quick Links:**

- [Install](#install)
- [How to obtain a Google API Key](./docs/GOOGLE_API_KEY.md)
- [Build & Run Guide](./docs/BUILD.md)

---

## Index

- [@freelensapp/ai-extension](#freelensappai-extension)
  - [Video Demo](#video-demo)
  - [Index](#index)
  - [Install](#install)
  - [How it works](#how-it-works)
  - [Connecting a provider](#connecting-a-provider)
    - [Custom OpenAI-compatible endpoints](#custom-openai-compatible-endpoints)
    - [Ollama](#ollama)
    - [Upgrading from an earlier version](#upgrading-from-an-earlier-version)
  - [Key Features](#key-features)
    - [Additional Resources](#additional-resources)

---
## Install
Open freelens > file > extensions and add the folowing string to the textbox: **@freelensapp/ai-extension**

or:

Use a following URL in the browser:
[freelens://app/extensions/install/%40freelensapp%2Fai-extension](freelens://app/extensions/install/%40freelensapp%2Fai-extension)

## How it works

Freelens AI is a **client of a large language model API**. It does not run a
model itself; it sends your prompts and the cluster context to a model provider
and renders the response.

The agent is built on the [pi](https://github.com/badlogic/pi-mono) agent SDK
and runs in the Freelens main process: one agent per cluster, with the cluster
tools, the approval gate and the saved chats. Your API keys and sign-ins stay in
the main process and are never sent to the Freelens windows. The cluster tools
run in the cluster's window, through the same Kubernetes access Freelens itself
uses.

Usage is billed by the provider you connect: per token with an API key, or
under your plan when you sign in with a subscription that allows it. Check that
your provider's terms allow using its subscription in a third-party app.

## Connecting a provider

Open **Preferences**, then **Freelens AI Settings**, and click **Add provider**.
Pick one of the providers pi supports (OpenAI, Anthropic, Google, DeepSeek,
Mistral, OpenRouter, Amazon Bedrock, GitHub Copilot and many more), then enter
an API key or sign in. Each connected provider gets a card listing its models
with their context size and price.

A provider whose key is set in an environment variable, such as
`OPENAI_API_KEY`, shows up as connected on its own. On macOS, Freelens started
from the Dock does not see the variables of your shell.

Choose the model in the chat's model picker; the chat remembers the last one
used. The **Thinking level** in the settings applies to every chat and to AI
Explain, and models that support fewer levels use the closest one.

Keys and sign-ins are saved in pi's own files in the extension's data folder:
`pi/auth.json`, and `pi/models.json` for custom endpoints.

### Custom OpenAI-compatible endpoints

Any server that speaks the OpenAI Chat Completions API, such as
[LiteLLM](https://github.com/BerriAI/litellm), vLLM or LM Studio, can be added
with **Add custom endpoint**: a name, the base URL, an optional API key, the
model ids, and whether the models support reasoning. The settings page shows the
path of `models.json` for anything the form does not cover (headers, prices).

### Ollama

[Ollama](https://ollama.com) exposes an OpenAI-compatible endpoint. Add it as a
custom endpoint with the base URL `http://localhost:11434/v1`, no API key, and
the exact model names including their tag (for example `llama3.2:3b`, as shown
by `ollama list`).

The model must support **tool calling**: the agent drives every cluster
operation through tools, so a model without tool support cannot be used.

### Upgrading from an earlier version

On the first start after the upgrade, the OpenAI key from the old settings is
moved into pi, and an old custom Base URL becomes a custom endpoint with its key
and model names. The old settings are then cleared. Chats from earlier versions
are not carried over.

---

## Key Features

Talk to your cluster in natural language. The agent reads, explains, and (with
your approval) changes Kubernetes resources, while the chat keeps the full
context of the conversation.

**Cluster operations through tools**

- **Any resource kind**: list, get, create, update, patch, and delete any
  Kubernetes resource — built-in kinds and CRDs alike.
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
- **Cluster insight**: query the Kubernetes server version and the warning
  events of a namespace.
- **AI Explain**: explain a Kubernetes event from its menu, with a diagnosis
  and recommended actions.

**Safe, human-in-the-loop changes**

- **Approval gate**: every change is shown for review — rendered as YAML — and
  applied only after you approve it. Which tools ask can be set per tool in the
  settings; reading pod logs asks too by default.
- **Approve all in this chat**: skip the approvals for the rest of one chat,
  until you turn it off or start a new chat.
- **Backups**: the current state of a resource is presented before it is
  changed, so a modification can be reverted.

**Chat experience**

- **Saved chats**: each cluster has its own chat, saved by the agent and
  restored after a restart. **New chat** starts an empty one, and chats unused
  for 30 days are deleted (configurable).
- **Stop**: a running answer can be stopped at any time.
- **Token counter, cost and context gauge**: live totals for the chat, with the
  cost from the model's price.
- **Automatic compaction**: long chats are summarized before they reach the
  model's context limit so the conversation can continue.
- **Rich rendering**: code blocks use the host Monaco editor, GitHub-flavored
  Markdown tables are supported, and model reasoning is shown in a collapsible
  block.
- **Custom agent rules** can be added from the preferences to steer the agent.

---

### Additional Resources

- [***Contribute***](CONTRIBUTING.md)
- [***Build freelens-ai-extension extension***](./docs/BUILD.md)
- [***Set up extension on freelens***](./docs/SET_UP_EXTENSION.md)

If you find this project useful, please consider giving it a star on
[***GitHub***](https://github.com/freelensapp/freelens-ai)!
