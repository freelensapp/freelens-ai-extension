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
  - [Available Models](#available-models)
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

> Currently only the OpenAI provider is enabled. Google/Gemini and Ollama
> support is temporarily disabled and will return after further refactoring.

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

- **Event Analysis**: Intelligent analysis of system events and logs
- **AI-Powered Pod Creation**: Automatically generate and configure pods using AI
- **Command Interface**: Natural language command processing and execution
- **Intelligent Assistance**: Get contextual help and suggestions for your operations

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
