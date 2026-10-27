# 08: Port, step 6: tooling and CI from the `main` branch

**What to build:** the maintainer gets the same tooling on both branches. The
Biome, Knip, Renovate, mise, metafile and workflow files are copied from the
`main` branch as they are; workflows are edited directly. Knip runs clean, and
the CI workflows run the same checks as the `main` branch.

Identical files keep the final merge (ticket 14) free of tooling conflicts.

**Blocked by:** 07 (port, step 5).

**Status:** ready-for-agent

- [x] The tooling and workflow files match the `main` branch, apart from
      differences the pi agent needs, each listed in the report.
- [x] Knip reports nothing; anything ignored has a reason in its config.
- [x] Biome passes with the `main` branch's config.
- [x] Every check from ticket 07 still passes.
- [ ] One commit, pushed; CI is green on the branch.
