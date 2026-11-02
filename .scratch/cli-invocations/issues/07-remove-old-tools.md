# 07: The twelve tools are removed

**What to build:** the agent reaches the cluster only through the `kubectl`
tool. The twelve structured tools and everything that only served them are
removed, the system prompt speaks of CLI invocations, and the documentation
describes the new design. This completes the first delivery slice.

See the spec, "The two tools", "The system prompt" and "Documentation".

**Blocked by:** 04, 05, 06

**Status:** ready-for-agent

- [x] The tool list holds only `kubectl`. The twelve tools are removed, along
      with the resolution of kinds to API paths, the manifest schemas and
      handlers, the field filter, the pod logs helpers, the projection, the
      version summary, the request error description, the approval
      preparation and backups per tool name, the per-tool approval settings,
      the old approval request fields, the stand-in cluster client and their
      tests.
- [x] The system prompt no longer says there is no shell, and drops the
      guidance for the old tools. It says that the agent runs kubectl through
      the tool within the floor and the profile, and that it keeps output small
      with `grep`, selectors and `-o`. The safety rules stay.
- [x] The chat's tool list shows the `kubectl` tool.
- [x] AGENTS.md is updated: the cluster tools and approvals sections, the test
      support list (stand-in CLI, fake kubectl), and "Rules That Fail
      Silently" (every invocation goes through the invocation policy; never a
      shell). The README is updated too.
- [x] `pnpm type:check`, `pnpm lint:check`, `pnpm test:unit`, `pnpm build` and
      `pnpm knip:check` pass with no leftover file or dependency.
- [ ] Checked in Freelens dev: a troubleshooting conversation on `kind-kind`
      (warning events, logs of a failing pod, a rollout restart) works with
      `kubectl` only.

## Comments

Built on `cli/07`. Decisions taken while building it:

1. **What went.** The twelve tool definitions and their runners, the
   resolution of kinds to API paths (`resource-paths.ts`, `cluster-api.ts`),
   the manifest schemas and handlers, the field filter, the pod logs helpers,
   the projection, the version summary, the request error description, the
   approval preparation (`approval.ts`) and backups per tool name
   (`approval-backup.ts`), the stand-in cluster client
   (`test/kube-json-api.ts`) and the tests of all of them. The host loses its
   `getClusterApi` option, so main no longer uses
   `Main.K8sApi.KubeJsonApi.forCluster`, and the test stub no longer has it.
   The per-tool approval settings and `approval-settings.ts` went in ticket 06.
2. **The approval request.** `ToolApprovalRequest`, `ApprovalTarget`, the
   `ApprovalRequest` union and `isCliApprovalRequest` are removed:
   `CliApprovalRequest` is the one request of the protocol, in the
   `ui_request` envelope and the snapshot. The chat's message object loses
   `actionDetails` and `resources`, and the approval card takes the request
   as a required prop.
3. **The tool definition** loses its `mutating` and
   `requiresApprovalByDefault` flags, which only the old gate read. The gate
   hands a `kubectl` call to the invocation policy and lets any other tool
   name through, since pi registers no other tool; `toPiTool` throws for a
   definition it has no runner for.
4. **Calls of the old tools in saved chats** still show, as the generic tool
   card with the tool's name and arguments, so the chat reducer and that card
   stay, and their tests keep old tool names as examples.
5. **The host tests** that drove the old tools now drive `kubectl`:
   `kubectl version` (Allow in Standard) where a read ran without a card,
   `kubectl scale` (Ask) where a change asked. The tests of "Approve all in
   this chat" moved under the approval gate with kubectl, "still blocks an
   invalid manifest" became "still blocks a call the floor rejects".
6. **The system prompt** drops the claim that there is no shell, the log
   filter, the subresource guidance and "patch over update". A `<kubectl>`
   section says that the agent runs kubectl through the tool, only within the
   floor and the profile of the `<cli_policy>` section, keeps the output small
   with selectors, `-o` and `grep`, and sets `revealSecrets` only when asked.
   The safety rules stay; the least destructive option is now written in
   kubectl's terms (`--force`, `--grace-period=0`, an empty finalizer list).
7. **Docs.** AGENTS.md: "Cluster tools in the main process" is now "CLI
   invocations in the main process", and "Approvals" is rewritten; "Rules
   That Fail Silently" drops the rule about unset query fields of the host's
   JSON client, which nothing uses any more, and gains "Every CLI invocation
   goes through the invocation policy" and "`execFile`, never a shell".

Manual check in Freelens dev, still to run: install the checkout in place on
`kind-kind` with Flux, connect a provider and choose a model, with every
cluster on Standard.

- The chat's tool list (the wrench next to the input) shows `kubectl` only.
- "Are there warning events in flux-system?": a `kubectl get events` (or
  `kubectl events`) invocation with `--field-selector type=Warning` or
  `grep`, without a card; the answer names the events.
- Make a pod fail (for example a Deployment with a bad image or a command
  that exits), then "why is this pod failing? show its logs": `kubectl describe`
  runs without a card, `kubectl logs ... --tail=<preference>` (or with
  `--previous`) asks, and after approval the answer quotes the log lines.
- "restart the deployment podinfo": a `kubectl rollout restart` card without
  a preview (`rollout restart` has no dry run); approve, then the agent checks
  with `kubectl rollout status` without a card.
- No error in DevTools of the cluster frame, and none of the `freelens-ai`
  scope in main's log.
