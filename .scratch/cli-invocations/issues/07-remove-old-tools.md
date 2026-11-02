# 07: The twelve tools are removed

**What to build:** the agent reaches the cluster only through the `kubectl`
tool. The twelve structured tools and everything that only served them are
removed, the system prompt speaks of CLI invocations, and the documentation
describes the new design. This completes the first delivery slice.

See the spec, "The two tools", "The system prompt" and "Documentation".

**Blocked by:** 04, 05, 06

**Status:** ready-for-agent

- [ ] The tool list holds only `kubectl`. The twelve tools are removed, along
      with the resolution of kinds to API paths, the manifest schemas and
      handlers, the field filter, the pod logs helpers, the projection, the
      version summary, the request error description, the approval
      preparation and backups per tool name, the per-tool approval settings,
      the old approval request fields, the stand-in cluster client and their
      tests.
- [ ] The system prompt no longer says there is no shell, and drops the
      guidance for the old tools. It says that the agent runs kubectl through
      the tool within the floor and the profile, and that it keeps output small
      with `grep`, selectors and `-o`. The safety rules stay.
- [ ] The chat's tool list shows the `kubectl` tool.
- [ ] AGENTS.md is updated: the cluster tools and approvals sections, the test
      support list (stand-in CLI, fake kubectl), and "Rules That Fail
      Silently" (every invocation goes through the invocation policy; never a
      shell). The README is updated too.
- [ ] `pnpm type:check`, `pnpm lint:check`, `pnpm test:unit`, `pnpm build` and
      `pnpm knip:check` pass with no leftover file or dependency.
- [ ] Checked in Freelens dev: a troubleshooting conversation on `kind-kind`
      (warning events, logs of a failing pod, a rollout restart) works with
      `kubectl` only.
