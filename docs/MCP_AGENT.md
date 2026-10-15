# Setting Up an MCP Agent for Freelens-AI

This guide will walk you through setting up an MCP (Model Context Protocol) agent to work with Freelens-AI, enabling you to control and interact with AI agents running on your infrastructure.

## Prerequisites

- You have Freelens-AI installed.
- You have Node.js and npx available in your system, on the `PATH` of your
  login shell.
- You have an OpenAI API Key, at the moment it only works with its models

## Where the servers run

The MCP servers run in the main process of Freelens, one set per cluster,
started on the first message or tool list of that cluster's chat. A server
started with a command gets the environment of the cluster's terminal in
Freelens: commands named without a path, such as `npx`, are found on the
`PATH` of your login shell, and `KUBECONFIG` points at the cluster the chat is
open for, through Freelens, rather than at the current context of your
kubeconfig. The cluster must be connected. Variables set in the `env` of a
server take precedence.

The servers stop when MCP is turned off or its configuration changes, when the
cluster disconnects, and when the extension is disabled or Freelens quits. The
next message starts them again.

## Configuration

Freelens-AI allows you to configure MCP agents directly from its Preferences page.

1. Open Freelens-AI Preferences<br/>
Launch Freelens-AI and go to the Preferences page then locate the MCP Configuration
section.

2. Enable MCP Support<br/>
Toggle the Enable MCP Agent option.<br />
This enables Freelens-AI to communicate with MCP agents running on your machine or cluster.

3. Add an MCP Server Configuration<br/>
Inside the dedicated JSON textarea, add your MCP server configuration.<br />
Below is the pre-built configuration for the MCP server for Kubernetes, included in Freelens-AI.

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

This uses npx to launch the mcp-server-kubernetes module. You can replace
this with your own agent command.

Recommended MCP Agent

For a robust setup, especially in Kubernetes environments, we recommend:
<https://github.com/Flux159/mcp-server-kubernetes>

Screenshots

![alt text](images/mcpsettings.png)
![alt text](images/mcpset.png)

## Troubleshooting

### Slow first message

- When you set up MCP Agent, the first message in chat it handles can be slow
  because it need to be initialized (our client should connect to the MCP
  Server you specified), so just wait for it to be fully initialized

### How the default configuration works

The pre-built configuration spawns `npx mcp-server-kubernetes`, so the very
first launch downloads the package from the npm registry, while later launches
reuse the npx cache. You never have to start the MCP server yourself: the
extension always spawns its own instance of the command you configured.

### Connection closed right after startup

The chat shows the error, and the main-process log of Freelens (the terminal
Freelens was started from, or its log file) has an error like:

```text
MCPClientError: Failed to connect to stdio server ... MCP error -32000: Connection closed
```

This means the spawned server process exited immediately. The first diagnostic
step is to run the configured command manually in the cluster's terminal in
Freelens, which has the same environment:

```bash
npx mcp-server-kubernetes
```

The real error becomes visible there. A healthy stdio server prints little or
nothing and keeps waiting for input, so exit it with Ctrl+C.

### Corrupted npx cache

If the first download was interrupted, the cache entry stays broken forever and
every run fails at import time with `ERR_MODULE_NOT_FOUND` pointing inside
`npm-cache/_npx/<hash>`. Delete that cache directory, then run the command
again to download the package from scratch. The hash is the one shown in the
error path.

On Windows (PowerShell):

```powershell
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\npm-cache\_npx\<hash>"
```

On macOS and Linux:

```bash
rm -rf ~/.npm/_npx/<hash>
```

### Corporate networks with TLS inspection

Where TLS traffic is inspected, the first npx download can fail with
certificate errors. Point both npm and Node.js at the corporate root
certificate:

```bash
npm config set cafile <corporate-root-ca.pem>
```

and set the `NODE_EXTRA_CA_CERTS` environment variable to the same file.

### Recommended stable setup

To avoid any download when the extension starts, install the server once:

```bash
npm install -g mcp-server-kubernetes
```

and then reference the command directly in the MCP configuration:

```json
{
    "mcpServers": {
        "kubernetes": {
            "command": "mcp-server-kubernetes"
        }
    }
}
```

### Windows: wrapping the command

If spawning `npx` directly keeps failing while the manual run works, wrap the
command with the Windows command interpreter:

```json
{
    "mcpServers": {
        "kubernetes": {
            "command": "cmd",
            "args": ["/c", "npx", "mcp-server-kubernetes"]
        }
    }
}
```
