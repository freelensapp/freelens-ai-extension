---
status: accepted
---

# Agent tools are CLI invocations of kubectl and helm

Supersedes [ADR 0002](./0002-cluster-tools-run-in-the-main-process.md) for
how the tools reach the cluster; they still run in the main process.

The agent reaches the cluster through two tools, `kubectl` and `helm`. Each
runs the binary that `Main.Shell` returns for the chat's cluster, with the
environment of `Main.Shell.getEnvironment(clusterId)`. That environment reaches
the cluster through Freelens's proxy. The binary is started with `execFile` and
an argument array, never through a shell. The twelve structured tools, which
sent requests by path, are removed. They covered a small, hand-picked part of
what kubectl and helm do: no label selectors, no discovery, no server-side dry
run, no rollouts, no exec and no Helm releases. Each new capability needed a
tool, a schema and an approval case of its own. Models already know kubectl
and helm well, so the CLIs give them the whole surface, server-side validation
and `--dry-run=server` for free.

The cost is that the arguments are free-form, so safety moves into the tools.
Every invocation is parsed into a canonical form. It is then checked against a
fixed floor that no setting lifts: no flag that changes the cluster or the
identity, no credentials, no access to the user's disk or local code, nothing
that never ends. Finally the policy profile of the cluster gives it a policy
level. Both tools are `executionMode: "sequential"`, so pi runs every call one
at a time and asks each approval only after the previous call has finished. A
server-side dry-run diff on an approval card is then always computed against
the current state. Invocations need no read or write classification, only an
internal list of the verbs that accept `--dry-run=server`.

A dry-run that the server rejects (invalid, forbidden, not found, already
exists, conflict, or denied by an admission webhook) fails the call with the
server's message, without asking: the real call would be rejected the same way,
and the model can correct it. Any other dry-run failure still asks, with
"Preview unavailable" and the reason on the card. That covers a webhook that
does not support dry runs, an API without `dryRun`, a transient error, or an
error we do not recognize. A wrong guess then costs one card, while failing
would block a valid change for good on a cluster with such a webhook.

## Considered Options

- **Keep and extend the structured tools by path**: precise approvals, but
  every capability is ours to build, and the tool list grows with it.
- **A raw API request tool** (method, path, body): as general as the CLIs,
  but the models compose API paths far less reliably than kubectl
  arguments, and it has no dry-run diff, rollout or Helm logic.
- **Separate read and write tools**: rejected, because pi runs a whole batch
  sequentially when any call in it belongs to a sequential tool.
- **Parallel tools with a write lock and one write per assistant message**:
  keeps the reads parallel. Rejected because pi asks every approval of a
  parallel batch before running any of them, so it needs a read or write
  classification that the user would have to maintain for new verbs. Running
  everything sequentially costs only latency on batches of reads.
