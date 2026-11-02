import { cliToolParameters } from "./kubectl-tool";

import type { AgentToolDefinition } from "./index";

// One CLI invocation of helm against the chat's cluster, with the same
// parameters as the kubectl tool. It runs one call at a time, and the
// invocation policy decides whether a call runs, asks or is blocked.
export const helmTool: AgentToolDefinition = {
  name: "helm",
  label: "Run helm",
  description:
    "Run one helm invocation against the cluster of this chat, through Freelens's connection to it. Pass the " +
    'arguments after "helm" in args, the verb first, for example ["list", "-n", "web"]. No shell is involved: no ' +
    "pipes, redirections or quoting. It reads releases (list, status, history, get values, get manifest, get " +
    "notes) and the charts of the repositories the user added (show, search repo), and changes releases with " +
    "rollback, uninstall and upgrade. upgrade takes a release, its chart as <repository>/<chart>, --reuse-values " +
    "and the values to change with --set. Local charts, chart URLs, values files and install are not available. " +
    "A change may take longer than the default timeout: set timeoutSeconds for upgrade, rollback and uninstall, " +
    "since helm killed in the middle leaves the release pending. " +
    "The values of the Secrets in a release's manifest (get manifest, and upgrade with --dry-run) are redacted; " +
    "set revealSecrets only when the user asks for them. " +
    "Keep the output small with -o and grep. The result holds the exit code, the standard output and the " +
    "standard error.",
  parameters: cliToolParameters("helm"),
};
