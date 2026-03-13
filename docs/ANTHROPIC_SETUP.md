# Anthropic (Claude) Setup

This guide explains how to configure Claude models in the Freelens AI extension.

## Getting an API Key

1. Go to [https://console.anthropic.com](https://console.anthropic.com)
2. Sign in or create an account
3. Navigate to **API Keys** in the left sidebar
4. Click **Create Key**, give it a name, and copy it

## Configuring the Extension

### Option A: Via the UI

1. Open Freelens and go to **Preferences** (gear icon)
2. Find the **Freelens AI** section
3. Paste your API key in the **Anthropic Key** field
4. Select one of the Claude models from the model dropdown:
   - **Claude Haiku 4.5** — fast and cost-efficient, great for quick queries
   - **Claude Sonnet 4.6** — balanced performance and intelligence (recommended)
   - **Claude Opus 4.6** — most capable, best for complex analysis

### Option B: Via Environment Variable

Set the `ANTHROPIC_API_KEY` environment variable before launching Freelens:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

The environment variable takes precedence over the value stored in preferences.

## Notes

- MCP (Model Context Protocol) is supported with Claude models
- Claude models support streaming responses
- See [https://docs.anthropic.com/en/docs/about-claude/models](https://docs.anthropic.com/en/docs/about-claude/models) for the latest model information
