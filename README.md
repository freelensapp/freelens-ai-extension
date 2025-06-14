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

---

**Quick Links:**

- [Ollama Setup & Model Image Guide](./docs/OLLAMA.md)
- [How to obtain a Google API Key](./docs/GOOGLE_API_KEY.md)
- [Build & Run Guide](./docs/BUILD.md)

---

## Index

- [@freelensapp/ai-extension](#freelensappai-extension)
  - [Index](#index)
    - [Available AI Providers](#available-ai-providers)
    - [Available Models](#available-models)
    - [Key Features](#key-features)
    - [Base Agent](#base-agent)
    - [MCP Agent](#mcp-agent)
      - [Additional Resources](#additional-resources)

---

### Available AI Providers

freelens-ai-extension integrates with multiple AI providers to offer a diverse
range of capabilities. Currently supported providers include:

- ***open-ai***
- ***deep-seek***

---

### Available Models

freelens-ai-extension currently supports integration with the following AI models:

- ***gpt-3.5-turbo***
- ***o3-mini***
- ***gpt-4.1***
- ***gpt-4o***
- ***deep-seek-r1***
- ***gemini-2.0-flash***

Each model offers different capabilities and performance characteristics.
Choose the one that best suits your needs and workflow requirements.

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
