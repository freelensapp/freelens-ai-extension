import { Type } from "typebox";

import type { AgentToolDefinition } from "./index";

/** The timeout of a kubectl invocation when the call sets none, in seconds. */
export const DEFAULT_CLI_TIMEOUT_SECONDS = 30;
/** The longest timeout a call can set, in seconds; a longer one is cut to it. */
export const MAX_CLI_TIMEOUT_SECONDS = 300;

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
  parameters: Type.Object({
    args: Type.Array(Type.String(), {
      description: 'The arguments after "kubectl", the verb first, each as its own string',
    }),
    manifest: Type.Optional(
      Type.String({
        description:
          "One or more objects as YAML (separated by ---) or JSON, sent on standard input. Only with apply, " +
          "create, replace, delete or diff",
      }),
    ),
    grep: Type.Optional(
      Type.String({
        description:
          "A JavaScript regular expression: only the lines of the standard output that match it are kept. " +
          "Case-sensitive and unanchored",
      }),
    ),
    timeoutSeconds: Type.Optional(
      Type.Number({
        exclusiveMinimum: 0,
        description: `How long kubectl may run before it is killed, in seconds: ${DEFAULT_CLI_TIMEOUT_SECONDS} when unset, at most ${MAX_CLI_TIMEOUT_SECONDS}`,
      }),
    ),
    revealSecrets: Type.Optional(Type.Boolean({ description: "Ask for the values of Secrets unredacted" })),
  }),
};
