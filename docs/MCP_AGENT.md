# Setting Up an MCP Agent for Freelens-AI 📡 

This guide will walk you through setting up an MCP (Model Control Protocol) agent to work with Freelens-AI, enabling you to control and interact with AI agents running on your infrastructure.

## Prerequisites

- You have Freelens-AI installed.
- You have Node.js and npx available in your system.

## Configuration

Freelens-AI allows you to configure MCP agents directly from its Preferences page.

1. Open Freelens-AI Preferences<br/>
Launch Freelens-AI. Go to the Preferences page. Locate the MCP Configuration
section.

2. Enable MCP Support<br/>
Toggle the Enable MCP Agent option. This enables Freelens-AI to communicate
with MCP agents running on your machine or cluster.

3. Add an MCP Server Configuration<br/>
Inside the dedicated JSON textarea, add your MCP server configuration. Below
is an example configuration for a Kubernetes-based MCP server:

```json
{ 
    "mcpServers": { 
        "kubernetes": { 
            "command": "npx", 
            "args": ["mcp-server-kubernetes"] 
        } 
    } 
} 
```

✅ This uses npx to launch the mcp-server-kubernetes module. You can replace
this with your own agent command.

🚀 Recommended MCP Agent

For a robust setup, especially in Kubernetes environments, we recommend:
<https://github.com/Flux159/mcp-server-kubernetes>

🖼️ Screenshots

![alt text](images/mcpsettings.png)
![alt text](images/mcpset.png)

## Troubleshooting

- When you set up MCP Agent, the first message in chat it handles can be slow
  because it need to be initialized (our client should connect to the MCP
  Server you specified), so just wait for it to be fully initialized
- Google Gemini models seems to have issued in MCP tool calling, thus the MCP
  Agent may have problems
