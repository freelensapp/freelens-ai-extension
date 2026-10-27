# 14: Final merge of the `main` branch

**What to build:** PR #290 can land. The `main` branch is merged into the pi
agent branch once the maintainer has run the manual test cases, so that the
merge brings in whatever Renovate and others changed there in the meantime.

Conflicts are resolved in favour of the pi agent wherever the code differs (the
LangChain files the pi agent deleted stay deleted, the HTTP/SSE bridge and MCP
stay out), and in favour of the `main` branch's versions wherever only tooling
or dependency versions differ.

**Blocked by:** 12 (AGENTS.md and README), 13 (manual test cases), and the
maintainer's run of the cases in 13 with every failure fixed.

**Status:** needs-human (waiting for the maintainer's run of the manual test
cases)

- [ ] The maintainer has reported the run of the manual test cases, and every
      failure is fixed or recorded as a known issue.
- [ ] The merge leaves no LangChain, LangGraph, bridge or MCP code.
- [ ] Tooling and dependency versions match the `main` branch after the merge,
      apart from the pi packages.
- [ ] Every check passes after the merge, and CI is green.
- [ ] PR #290 shows no conflicts with the `main` branch.
- [ ] The pi agent build tickets whose manual checks passed are marked
      resolved.
