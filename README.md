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
freelens-ai-extension currently supports integration with the following AI models:

- ***gpt-3.5-turbo***
- ***o3-mini***
- ***gpt-4.1***
- ***gpt-4o***
- ***gemini 2.0 flash***

Each model offers different capabilities and performance characteristics.
Choose the one that best suits your needs and workflow requirements.

### Connecting a model
You can connect your model by setting its API Key in the preferences page or by using you environment variables;
for example you can set:
- GOOGLE_API_KEY = ...
- OPENAI_API_KEY = ...

together to switch model without switch the API Key in settings page.

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
