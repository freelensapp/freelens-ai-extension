# Manual test cases: the agent's tools are CLI invocations

The cases the maintainer follows by hand in Freelens dev to check the branch
`cli-invocations` (spec `spec.md`, tickets 01 to 11 and the fixes of the code
review). They collect the checks every ticket left for Freelens dev, which the
implementers could not run. The mapping table is at the end.

Each case has numbered steps and the expected result. Mark the result line
with an `x` (`[x] Pass`) and add a note when a case fails or cannot be run. A
case whose precondition cannot be met is **Blocked**, not failed.

The expected results quote the labels and messages of the code at the time of
writing. A wording that differs but says the same is not a failure.

## Environment

- **Freelens v2** run from its checkout at `/home/hl/projects/freelens/freelens`
  with `pnpm dev`.
- **The extension**: this checkout on `cli-invocations`, built with Node 24
  (`pnpm install && pnpm build`), installed in place from the Extensions page.
- **A kind cluster** `kind-kind` with Flux and its workloads, and a
  Deployment called **podinfo** below (any Deployment will do). For the helm
  cases, a release: `helm repo add podinfo https://stefanprodan.github.io/podinfo`
  then `helm install podinfo podinfo/podinfo -n default`, whose chart renders
  no Secret; for H3 and H4, a release whose chart renders a Secret.
- **A provider** that can call tools, connected in the preferences, and a
  model chosen in the chat's model picker.
- Every cluster on the **Standard** profile unless a case says otherwise.
- After each case: no error in DevTools of the cluster frame or the root
  frame, and none of the `freelens-ai` scope in main's log. Keep only
  warnings, errors and the extension's own lines from the console (see
  "Checking the Extension in Freelens Dev" in AGENTS.md).

## A. Running kubectl

### A1. A read runs without a card

1. In a `kind-kind` chat, ask "list the pods in flux-system".

Expected: the tool card shows `kubectl get pods -n flux-system`, runs without
an approval card, and its folded "Output, exit code 0" holds the pods; the
answer names them. The chat's tool list (the wrench next to the input) shows
`kubectl` and `helm` only.

- [ ] Pass

### A2. The kubectl download

1. Use a cluster whose Kubernetes version Freelens has not downloaded a
   kubectl for (or delete the downloaded binary), and ask for a read.

Expected: the tool card shows the download phases and percentage while it
runs, then the output.

- [ ] Pass

### A3. Stop ends a running invocation

1. Ask for `kubectl rollout status` of a Deployment that does not become
   ready, with a `timeoutSeconds` of 300; press Stop while it runs.

Expected: the run ends, and the tool card's output says "kubectl was stopped
before it ended.".

- [ ] Pass

### A4. Logs get the tail default, whatever the order of the flags

1. Ask "show the logs of a flux-system pod"; if the agent writes
   `-n flux-system logs ...`, so much the better. Approve the card.

Expected: `kubectl logs` asks (Standard), and the command line that ran ends
with `--tail=<the pod logs tail lines preference>`.

- [ ] Pass

### A5. Warning events and a failing pod

1. "Are there warning events in flux-system?"
2. Make a pod fail (a Deployment with a bad image), then "why is this pod
   failing? show its logs".

Expected: 1 runs `kubectl get events` or `kubectl events` with a selector or
`grep`, without a card. 2 runs `kubectl describe` without a card, asks for
`kubectl logs`, and the answer quotes the log lines.

- [ ] Pass

## B. The floor and the policy levels

### B1. Ask, "Approve all in this chat" and Always ask

1. "Scale podinfo to 2".
2. Answer "Approve all in this chat"; then "scale podinfo to 3".
3. In the same chat, "show /etc/hostname inside a flux-system pod".

Expected: 1 shows a card with the command line as its header, the target
`kubectl scale deployments podinfo -n <ns>` and "Ask: the policy profile
Standard asks before this invocation.". 2 runs without a card. 3 shows a
`kubectl exec` card that says "Always ask: ..." and offers only yes and no.

- [ ] Pass

### B2. The floor

1. "List the pods with --context kind-other".
2. "Describe the secrets in kube-system".

Expected: no card for either. The tool card of 1 shows "blocked" and "Blocked
by the floor, which no policy profile lifts. Flags that change the cluster or
the identity: --context is never allowed. ...". The tool card of 2 shows the
floor's reason that `kubectl describe` prints Secret values such as
service-account tokens, pointing to `get secrets` or `revealSecrets`.

- [ ] Pass

### B3. Denying, reopening, Stop during a card

1. Deny a card.
2. Leave a card pending, open another page of the cluster and come back.
3. With a card pending, press Stop.

Expected: 1 shows "The user denied the action" on the tool card. 2 shows the
card again, with its preview. 3 closes the card as denied and ends the run.

- [ ] Pass

## C. The dry-run preview

### C1. A diff

1. "Scale podinfo to 3".

Expected: under "What the dry run changes", the target's diff with
`-  replicas: <n>` and `+  replicas: 3`, and no `managedFields`. Approve: the
tool result shows only kubectl's own output, and the chat's JSONL file holds
no dry-run YAML.

- [ ] Pass

### C2. A change the cluster rejects

1. "Patch podinfo to set spec.replicas to -1".

Expected: no card; the tool card shows "blocked" and "The cluster rejected a
server-side dry run of this call, so it did not run: ... is invalid: ...".

- [ ] Pass

### C3. Preview unavailable

1. "Delete the pods with label app=podinfo".
2. "Cordon one of the nodes".
3. "Restart podinfo".

Expected: 1 says "Preview unavailable" because the targets are chosen by a
selector, and lists the pods the dry run reports. 2 says "Preview
unavailable: kubectl cordon prints no object in a dry run" with "Current
YAML" folded. 3 (`rollout restart`, which has no dry run) shows a card
without a preview. Deny all three.

- [ ] Pass

### C4. A webhook without dry-run support

1. Add a validating webhook with `sideEffects: Unknown` on Deployments.
2. "Scale podinfo to 2".

Expected: the card still asks, with "Preview unavailable: ..." naming the
missing dry-run support, and the current YAML.

- [ ] Pass

## D. Secrets

### D1. Redaction

1. By hand: `kubectl create secret generic db -n default --from-literal=password=hunter22`,
   and `kubectl apply` a Secret manifest.
2. "Show the db secret as yaml"; the same for the applied Secret.
3. "List the secrets in default".

Expected: 2 runs `kubectl get secrets db -n default -o json` without a card;
the answer gives the keys, the type and "redacted, 8 bytes", never the value;
the applied Secret's last-applied annotation shows its size only. 3 shows the
table as kubectl prints it.

- [ ] Pass

### D2. Reveal

1. "What is the db password?" (the agent sets `revealSecrets`). Deny.
2. Ask again and approve.

Expected: a card with the target `kubectl reveal secrets db -n default` and
the line that the values will be sent to the model unredacted. 1 shows "The
user denied the action"; 2 brings the value back.

- [ ] Pass

## E. Policy profiles

### E1. Migration of the old approval choices

1. Before installing, put `toolApprovalOverrides: { "getPodLogs": false }` in
   the preferences file of an older build.
2. Start Freelens with this build.

Expected: the file holds a user profile "Standard (migrated)" with
`kubectl logs *` Allow, `defaultProfileId: "standard-migrated"` and
`toolApprovalOverrides: null`; "show the logs of a flux-system pod" runs
without a card.

- [ ] Pass

### E2. The profile editor

1. Preferences, Freelens AI Settings, "Policy profiles": check the shipped
   profiles.
2. "New profile": "Start from" shows "Copy of Standard"; create it.
3. Edit a rule's pattern (click elsewhere to save), change its level, remove
   a row, add `kubectl scale * -n dev` as Allow, set the fallback level to
   Deny. Restart Freelens.
4. Rename, duplicate, delete the copy.
5. Make the profile the default profile; in a chat, scale a Deployment in
   `dev`. Delete the profile; scale again.

Expected: 1 lists Read only, Standard and Permissive tagged "Shipped", and
Standard "Default"; a shipped profile shows its rules as text, a "cannot be
changed" line and only "Duplicate". 2 selects the new profile with Standard's
rules as editable rows. 3 survives the restart. 5 runs the scale without a
card, then asks again once Standard is back as the default profile. Both
themes look right.

- [ ] Pass

### E3. The test box and the floor list

1. With Standard chosen, type in "Test a command line":
   `kubectl get pods -n web`, then `kubectl scale deployment api --replicas=2`.
2. Choose Read only in the list.
3. In a user profile with `kubectl delete *` Allow and
   `kubectl delete pods * -n prod` Ask, type `kubectl delete pod web -n prod`,
   then `kubectl delete pod/web deployment/api -n dev`.
4. Type `kubectl get pods --kubeconfig /tmp/x`, `kubectl get pods -l 'app=web`,
   `oc get pods`, and `helm list -A`.
5. Look at "Floor" below the editor.

Expected: 1 shows Allow from `kubectl get *` with the form
`kubectl get pods * -n web`, then Ask with "None, fallback level". 2 keeps the
line and shows Deny. 3 shows Ask from the specific rule, then two rows and the
most restrictive level. 4 shows "Rejected by the floor" with the reason, "The
single quote is not closed.", "Start the command line with kubectl or helm.",
and Allow for the helm read. 5 lists every entry with its reason.

- [ ] Pass

### E4. Profiles per cluster and the badge

1. Catalog, settings of `kind-kind`, the "Freelens AI" tab: pick "Read only".
2. Open the chat of `kind-kind`.
3. Ask to scale a Deployment.
4. Preferences, "Cluster profiles": set `kind-kind` back to "Default profile
   (Standard)".

Expected: 2 shows the badge "Read only" at the top left. 3 is denied with the
profile's reason, without a card. 4 lists `kind-kind` with "Read only" before
the change, and the badge follows at once.

- [ ] Pass

### E5. A profile change while a card is pending

1. "Scale podinfo to 2"; while the card is pending, assign the cluster a user
   profile with `kubectl scale *` set to Always ask.
2. Again, and assign Read only instead.
3. Again, and switch to Read only while the dry run is still running (a slow
   cluster, or a webhook that delays it).

Expected: 1 turns the same card into Always ask, without "Approve all in this
chat", with the new profile name. 2 closes the card as denied with "Denied by
the policy profile "Read only": ...". 3 shows no card and blocks the call with
the same reason.

- [ ] Pass

## F. Helm

### F1. Reads

1. "List the helm releases of the cluster".
2. "Show the history of podinfo".

Expected: `helm list -A` (or with `-n`) and `helm history podinfo -n <ns>` run
without a card, and the answers name the releases and revisions.

- [ ] Pass

### F2. Writes

1. "Scale podinfo to 2 replicas through helm". Deny.
2. "Roll podinfo back". Deny.
3. "Uninstall podinfo". Deny.
4. "Upgrade podinfo from ./chart".

Expected: 1 shows `helm upgrade podinfo podinfo/podinfo --reuse-values --set
replicaCount=2`, the target `helm upgrade releases podinfo -n <ns>` and the
manifest diff with the replicas. 2 shows the diff to the previous revision.
3 says Always ask, without "Approve all in this chat". 4 is blocked by the
floor entry for the user's disk.

- [ ] Pass

### F3. Secrets in helm output

1. On a release whose chart renders a Secret: "show the manifest of
   `<release>`".
2. "What is the password in that Secret?" Approve.
3. Under Permissive: "what would `helm upgrade <release> <repo>/<chart>
   --reuse-values --set replicaCount=2 --dry-run` change?"
4. "Run helm status `<release>` -o json".

Expected: 1 shows the Secret's values as "redacted, N bytes" and the other
documents unchanged. 2 shows a card with `helm reveal releases <release> -n
<ns>`, and the values come back once approved. 3 redacts the Secrets of the
hooks and the manifest and keeps the NOTES. 4 is blocked by the floor (Secret
output).

- [ ] Pass

### F4. Long helm changes and the working directory

1. An upgrade that takes longer than 30 s (`--wait` on a slow rollout),
   without `timeoutSeconds`. Approve.
2. Start Freelens from a directory that contains `podinfo/podinfo/` with a
   `Chart.yaml`, and ask for an upgrade of `podinfo/podinfo`.

Expected: 1 runs to the end. 2's diff shows the repository chart, not the
local one, and `<extension folder>/cli-working-directory/` exists and is
empty.

- [ ] Pass

## Mapping

| Ticket                                        | Cases                      |
| --------------------------------------------- | -------------------------- |
| 01 The agent runs kubectl invocations         | A1, A2, A3                 |
| 02 The invocation policy                      | B2, E3 (and unit tests)    |
| 03 The floor and the policy levels            | A1, B1, B2, B3             |
| 04 A dry-run preview on approval cards        | C1, C2, C3, C4, B3         |
| 05 Secret redaction and reveal                | D1, D2, B2                 |
| 06 Profiles in the store                      | E1, E5                     |
| 07 The twelve tools are removed               | A1, A5                     |
| 08 The profile editor                         | E2                         |
| 09 The test box and the floor in preferences  | E3                         |
| 10 Profiles assigned per cluster              | E4                         |
| 11 The helm tool                              | F1, F2, F3, F4             |
| Code review fixes                             | A4, B2, E5, F3, F4         |
