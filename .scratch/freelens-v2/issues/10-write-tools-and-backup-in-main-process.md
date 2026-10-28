# 10: Write tools run in the main process, with the backup on the approval card

**What to build:** the second half of ADR 0002. Every change to the cluster
runs in the main process after the user approves it, and the approval card
shows the change and the backup YAML together. The frame takes no part in tool
calls any more; a frame reload during a pending change no longer leaves its
outcome unknown.

What the write tools send, matching what the host's `KubeApi` sends:

- create and update set the kind, apiVersion, name and namespace on the
  manifest; update is a PUT;
- a patch is a JSON merge patch; a patch of a subresource (such as `scale`)
  is a strategic merge patch;
- a delete uses background propagation; a force delete adds a grace period
  of 0; "force finalize" clears the finalizers with a merge patch;
- deleting a pod with its finalizers clears them with a JSON merge patch
  setting `finalizers` to `null` (#309), then deletes the pod, and the result
  reports what the cluster answered;
- evicting a pod posts to its `eviction` subresource;
- a restart of a deployment, daemon set or stateful set is a strategic merge
  patch of the `restartedAt` annotation of the pod template.

The approval gate loads the current object before asking, for every tool that
changes an existing object, and puts its YAML (apiVersion, kind, metadata,
spec, status) on the approval request. A failed load leaves the card without a
backup, as today. The frame shows the backup from the request.

The frame path goes: the `tool_request` envelope, the `tool_result` command,
the pending tool requests of the snapshot, the frame's tool runner, the
frame-side cluster tools and the `Cluster` interface.

**Blocked by:** 09 (read tools run in the main process).

**Status:** resolved (HITL check pending: manual-test-cases.md)

- [x] Tool tests on the stand-in assert the method, path, query, body and
      content type of every write operation above.
- [x] A test proves that deleting a pod with its finalizers sends a merge
      patch with `finalizers: null` and reports the cluster's answer.
- [x] Agent host test: an approval request carries the backup YAML, and a
      failed load leaves it out without blocking the approval.
- [x] Agent host test: a write runs only after approval, and a denied or
      stopped approval sends no request.
- [x] Chat reducer tests: snapshots and envelopes without tool requests; the
      approval card shows the backup from the request.
- [x] The protocol, the frame client and the snapshot hold no tool request
      bookkeeping; no frame code calls the cluster for a tool.
- [x] Every check passes, Knip included; one commit, pushed.
