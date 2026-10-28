# 09: Read tools run in the main process

**What to build:** the first half of ADR 0002. When the assistant reads the
cluster, the agent host runs the tool itself, through Freelens, without asking
the cluster frame. The user sees the same tool calls and results, a reload of
the frame no longer breaks a read, and the assistant's reads leave the lists
the user is looking at alone.

- The agent host receives one injected function that gives the JSON client of
  a cluster; in the extension it is `Main.K8sApi.KubeJsonApi.forCluster`.
- For each call the host asks the catalog for the chat's cluster. A cluster
  Freelens does not know, or one that is not connected, gets the error result
  "cluster not connected" and no request is sent.
- The read tools go by path: list namespaces, cluster version, warning events
  of a namespace, list and get of any kind, pod logs. A kind and apiVersion
  resolve to their plural and scope from the group version's discovery
  document, fetched on every call with no cache; subresources are skipped when
  looking up a kind. The path helpers follow the `main` branch.
- Pod logs come from the `log` subresource as raw text; the query carries only
  the parameters that are set, never an empty value (#308), so the running
  container is read unless the assistant asks for the previous one. The tail
  lines preference is read in the main process.
- Each request gets pi's abort signal for the tool call, so Stop cancels a
  request in progress. There is no fixed timeout.
- A failed request is described for the model from the shapes the host's
  client rejects with (an `Error`, a Kubernetes `Status`, the host's parsed API
  error).
- The stand-in client from the `main` branch (canned answers by path,
  discovery included, every request recorded) is the one cluster fake for the
  tool tests and the agent host tests.

Write tools still go to the frame until ticket 10: the main-process runner is
added beside the frame path, and ticket 10 removes the frame path.

**Blocked by:** 07 (port, step 5).

**Status:** resolved (HITL check pending: manual-test-cases.md)

- [x] Agent host test: a read tool call runs in the main process, its result
      reaches the model, and no `tool_request` envelope is broadcast.
- [x] Agent host test: a read on an unknown or disconnected cluster returns
      "cluster not connected" and sends no request.
- [x] Agent host test: Stop during a read aborts the request in progress.
- [x] Tool tests on the stand-in assert the path and query of each read,
      including built-in kinds, a custom resource and an irregular plural.
- [x] A pod logs test proves that no empty value goes into the query.
- [x] Error description tests cover the three rejection shapes.
- [x] The pure tool helpers keep their tests; the read tests no longer use the
      fake `Cluster`.
- [x] Every check passes; one commit, pushed.
