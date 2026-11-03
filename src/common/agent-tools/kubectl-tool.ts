import { cliToolParameters } from "./cli-tool-parameters";

import type { AgentToolDefinition } from "./index";

// One CLI invocation of kubectl against the chat's cluster. It runs one call
// at a time, and the invocation policy decides whether a call runs, asks or is
// blocked.
export const kubectlTool: AgentToolDefinition = {
  name: "kubectl",
  label: "Run kubectl",
  description:
    "Run one kubectl invocation against the cluster of this chat, through Freelens's connection to it. Pass the " +
    'arguments after "kubectl" in args, the verb first, for example ["get", "pods", "-n", "web"]. No shell is ' +
    "involved: no pipes, redirections or quoting. To send objects, put them in manifest as YAML or JSON and use " +
    'apply, create, replace, delete or diff; the tool adds "-f -". Files cannot be read. Keep the output small ' +
    "with selectors, -o and grep. The result holds the exit code, the standard output and the standard error.",
  parameters: cliToolParameters("kubectl"),
};
