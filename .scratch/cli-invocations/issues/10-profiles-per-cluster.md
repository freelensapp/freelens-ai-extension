# 10: Profiles assigned per cluster

**What to build:** the user picks each cluster's policy profile in the
cluster's own settings and sees every assignment in a table in the
preferences. The chat header shows the cluster's profile, so the user knows
what the agent may do before typing.

See the spec, "Renderer" (cluster settings tab, badge, assignment table).

**Blocked by:** 06

**Status:** ready-for-agent

- [x] A "Freelens AI" tab registered through `entitySettings` for the cluster
      entity holds a profile picker for that cluster, wrapped in an error
      boundary like the other registrations.
- [x] The preferences show a table of the clusters Freelens knows with their
      profile, editable there too.
- [x] The chat header shows a badge with the cluster's profile name, which
      follows a change at once.
- [x] The test stub of `@freelensapp/extensions` supports `entitySettings`.
      View tests in jsdom cover the tab, its registration, the table and the
      badge.
- [ ] Checked in Freelens dev: switching `kind-kind` to Read only shows the
      badge, and a `scale` the agent then attempts is denied with the reason.

## Comments

- The picker offers "Default profile (Standard)", named after the current
  default, before the shipped and user profiles. Picking it removes the cluster's assignment,
  so the cluster follows the default profile again; a cluster without an
  assignment, or assigned to a profile that no longer exists, shows it
  selected. Clearing the selection changes nothing. Every pick replaces
  `profileAssignments` as a whole, so main re-checks pending approvals.
- The chat has no header bar, so the badge sits at the top left of the chat,
  in a header row it shares with the "Approving all actions in this chat"
  notice on the right. Its tooltip names the profile, what it decides and where
  to change it.
- The table is a section "Cluster profiles" of the preferences page, right
  after ticket 08's "Policy profiles" section (moved there when the two were
  merged), with a picker per cluster, sorted by name; it lists
  `Renderer.Catalog.getAllClusters()`, and says so when there is none.
- The tab is registered for `Common.Catalog.KubernetesCluster.apiVersion` and
  `kind` (`entity.k8slens.dev/v1alpha1`, `KubernetesCluster`), and takes the
  cluster id from `entity.getId()`.
- Manual check in Freelens dev (not run): with the extension installed in
  place and `kind-kind` connected,
  1. open the catalog, the settings of `kind-kind`, and the "Freelens AI" tab
     under "Extensions": it shows "Policy profile" with "Default profile
     (Standard)" selected; pick "Read only";
  2. open the Freelens AI chat of `kind-kind`: the badge at the top left reads
     "Read only" (it should change at once when the tab or the preferences
     table switch the profile while the chat is open);
  3. ask the agent to scale a deployment of `kind-kind`, for example
     `kubectl scale deployment <name> -n <ns> --replicas=2`: the tool call is
     denied with the profile's reason and no approval card shows;
  4. open Preferences, Freelens AI Settings: "Cluster profiles" lists
     `kind-kind` with "Read only"; set it back to "Default profile
     (Standard)", and the badge follows;
  5. no error in DevTools of the root frame or the cluster frame.
