# Manual test cases: the pi agent on Freelens v2

The cases the maintainer follows by hand in Freelens v2 to check the port of the
pi agent branch (`piagent`) before PR #290 lands. They cover every user story of
`spec.md` and the pending manual (HITL) checks of the fourteen pi agent build
tickets in `.scratch/pi-agent-build/issues/`. The mapping tables are at the end.

Each case has preconditions, numbered steps, the expected result and a result
line. Mark the result line with an `x` (`[x] Pass`) and add a note when a case
fails or cannot be run. A case whose precondition cannot be met (no second
provider, no subscription login) is **Blocked**, not failed.

The expected results quote the labels and messages of the code at the time of
writing (`piagent` with tickets 01 to 11). Section [Known gaps](#known-gaps)
lists behaviour that makes a case fail on purpose, so that it is not reported
twice.

## Environment

- **Freelens v2** run from its checkout at `/home/hl/projects/freelens/freelens`
  in development mode (`pnpm dev`), with its `FreelensDev` profile in
  `~/.config/FreelensDev`. The cases assume a profile where this extension has
  not been installed before; on a used profile, log out of every provider card
  before case B1.
- **The extension under test**: the checkout of the branch under test, here
  `/home/hl/projects/freelens/freelens-ai-extension` (call it `$EXT`), built with
  Node 24 (`.nvmrc`).
- **A kind cluster** with the kubeconfig context `kind-lan-dev` (kind cluster
  `lan-dev`, node container `lan-dev-control-plane`), `kubectl`, `docker` and
  `jq` on the path.
- **At least one provider login** that can call tools, called **P** below, with
  a model **M** that streams its reasoning (any current reasoning model of
  OpenAI, Anthropic, Google, OpenRouter and similar). Cases that need more (a
  second provider, a subscription sign-in, a Google key, Ollama, `mitmproxy`)
  say so in their preconditions.
- Linux paths are used throughout; on macOS the profile is
  `~/Library/Application Support/FreelensDev`.
- The root `pnpm dev` of Freelens runs through Turbo, which does not pass on
  environment variables it does not know (a provider key such as
  `OPENAI_API_KEY`, `HTTPS_PROXY`). When Freelens needs one (E3, or P's key
  from the environment), start the app from the `freelens/` folder of the
  checkout instead: `cd /home/hl/projects/freelens/freelens/freelens && OPENAI_API_KEY=... pnpm dev`.

Suggested order: Setup, A1, B1 (needs no provider connected), E1 (connects P),
then the rest of the sections in order. A7, A3, A4 and A5 restart or rebuild
the extension; they can run at any point after E1.

## Setup

### S1. Run Freelens v2 from its checkout

1. In `/home/hl/projects/freelens/freelens`, the first time:
   `nvm install`, `corepack enable pnpm`, `pnpm i`, `pnpm build:di`, `pnpm build`.
2. Start it with `pnpm dev` and keep that terminal open: it shows the main
   process log, including the extension's main-process lines (prefixed
   `[freelens-ai]`). Freelens also writes its own log, with debug lines, to
   `lens.log` (`find ~/.config/FreelensDev -name lens.log`).
3. A development profile reads no kubeconfig by itself: open
   **File > Preferences** (Ctrl+,), **Kubernetes**, **Kubeconfig Syncs**, and
   sync `~/.kube` (button **Sync**).
4. Open the renderer console with **View > Toggle Developer Tools**. Messages of
   the cluster frames (`<cluster id>.renderer.freelens.app`) show there too.

### S2. Build the extension and install it from its directory

1. In `$EXT`: `nvm use`, `pnpm install --frozen-lockfile`, `pnpm build` (it ends
   with the built-output checks of `pnpm check:dist`, which must pass).
2. This is case A1; run it now.
3. For the cases that rebuild (A3, A7), run `pnpm dev` in `$EXT` in a second
   terminal: it rebuilds `dist/main.js` and `dist/renderer.js` on every save.

### S3. Shell helpers

Paste into the shell used for the cases (bash or zsh). The extension's data
folder exists once the extension has been activated (after A1).

```sh
k() { kubectl --context kind-lan-dev "$@"; }

# The extension's data folder: pi/ (auth.json, models.json) and sessions/.
export FAE_DATA="$(dirname "$(dirname "$(find ~/.config/FreelensDev/extension_data -path '*/pi/legacy-import-done' | head -n 1)")")"
# The extension's preferences file.
export FAE_PREFS=~/.config/FreelensDev/extension-store/@freelensapp/ai-extension/freelens-ai-preferences-store.json
echo "$FAE_DATA"

# The newest chat file (the chat used last, whatever the cluster).
fae_chat() { ls -t "$FAE_DATA"/sessions/*/*.jsonl | head -n 1; }

# The tool calls and tool results of that chat, as the model saw them.
fae_tools() {
  jq -r 'select(.type == "message") | .message
    | if .role == "assistant" then (.content[]? | select(.type == "toolCall") | "CALL   \(.name) \(.arguments | tostring)")
      elif .role == "toolResult" then "RESULT \(.toolName) error=\(.isError): \((.content[0].text // "")[0:400])"
      else empty end' "$(fae_chat)"
}
```

The chat does not show tool calls (see [Known gaps](#known-gaps)), so the cases
read them with `fae_tools`.

### S4. Test objects

```sh
k create namespace fae-test

k apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: fae-test
  labels:
    app: web
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: nginx
          image: nginx:1.27-alpine
          ports:
            - containerPort: 80
---
# Crash-loops: runs 60 s, prints its start time, exits 1. After the first
# restart the running container and the previous one have different logs.
apiVersion: v1
kind: Pod
metadata:
  name: crashy
  namespace: fae-test
spec:
  containers:
    - name: main
      image: busybox:1.36
      command: ["sh", "-c", "echo \"instance started at $(date +%T)\"; sleep 60; echo \"instance exiting at $(date +%T)\"; exit 1"]
---
# Ten lines a second, every tenth an ERROR line.
apiVersion: v1
kind: Pod
metadata:
  name: chatty
  namespace: fae-test
spec:
  containers:
    - name: main
      image: busybox:1.36
      command: ["sh", "-c", "i=0; while true; do i=$((i+1)); if [ $((i % 10)) -eq 0 ]; then echo \"ERROR request $i failed\"; else echo \"INFO request $i ok\"; fi; sleep 0.1; done"]
---
# Keeps producing Warning events (Failed, BackOff).
apiVersion: v1
kind: Pod
metadata:
  name: bad-image
  namespace: fae-test
spec:
  containers:
    - name: main
      image: registry.invalid/fae/does-not-exist:1.0
---
# A custom resource whose plural is irregular, with a status subresource.
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: octopi.test.freelens.app
spec:
  group: test.freelens.app
  scope: Namespaced
  names:
    kind: Octopus
    listKind: OctopusList
    singular: octopus
    plural: octopi
  versions:
    - name: v1
      served: true
      storage: true
      subresources:
        status: {}
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                arms:
                  type: integer
EOF

k wait --for=condition=Established crd/octopi.test.freelens.app --timeout=60s
k apply -f - <<'EOF'
apiVersion: test.freelens.app/v1
kind: Octopus
metadata:
  name: paul
  namespace: fae-test
spec:
  arms: 8
EOF
```

A warning event with a known message (events expire after an hour; run it
again before F1 if it is older):

```sh
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
k apply -f - <<EOF
apiVersion: v1
kind: Event
metadata:
  name: fae-test-warning
  namespace: fae-test
type: Warning
reason: FaeTestWarning
message: "Readiness probe failed: HTTP probe failed with statuscode: 503"
involvedObject:
  apiVersion: apps/v1
  kind: Deployment
  name: web
  namespace: fae-test
source:
  component: fae-manual-test
count: 1
firstTimestamp: "$NOW"
lastTimestamp: "$NOW"
EOF
```

A pod stuck in Terminating by a finalizer (for C9; create it right before the
case):

```sh
k apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: stuck-pod
  namespace: fae-test
  finalizers:
    - test.freelens.app/block-deletion
spec:
  terminationGracePeriodSeconds: 5
  containers:
    - name: main
      image: busybox:1.36
      command: ["sleep", "3600"]
EOF
k -n fae-test wait --for=condition=Ready pod/stuck-pod --timeout=60s
k -n fae-test delete pod stuck-pod --wait=false
sleep 10; k -n fae-test get pod stuck-pod   # STATUS Terminating, stays so
```

A read-only user of the same cluster, for C14 and G1. It appears in the
catalog as a second cluster, `kind-lan-dev-viewer`:

```sh
k -n fae-test create serviceaccount fae-viewer
k create clusterrolebinding fae-viewer --clusterrole=view --serviceaccount=fae-test:fae-viewer
kubectl config set-credentials fae-viewer --token="$(k -n fae-test create token fae-viewer --duration=24h)"
kubectl config set-context kind-lan-dev-viewer --cluster=kind-lan-dev --user=fae-viewer --namespace=fae-test
```

Cleanup after the run: `k delete namespace fae-test`,
`k delete crd octopi.test.freelens.app`, `k delete clusterrolebinding fae-viewer`,
`kubectl config delete-context kind-lan-dev-viewer`,
`kubectl config delete-user fae-viewer`, and undo the changes of B9, E7 and E8.

## A. Installing and loading

### A1. Install from the directory; both processes load cleanly

Preconditions: S1 and S2 step 1 done; Freelens running.

1. Open **File > Extensions** (Ctrl+Shift+E).
2. Type `$EXT` (the absolute path) into the field "Name, URL, or path to a
   package or directory" and click **Install**.
3. Confirm the dialog.
4. Check the terminal of Freelens and the DevTools console.

Expected:

- The dialog reads `Load the extension @freelensapp/ai-extension@VERSION from
PATH?` with **Install**; afterwards a notification `Extension
@freelensapp/ai-extension@VERSION is now loaded from PATH.` (VERSION from
  `package.json`, PATH the directory).
- The row in "Installed extensions" shows the version from `package.json` with
  the **unverified** badge, and the status **Enabled** (not "Incompatible",
  not "Failed to load").
- No error or warning line from the extension in either log (`[freelens-ai]`,
  `[EXTENSIONS-LOADER]: activation extension error`, a stack trace naming
  `dist/main.js` or `dist/renderer.js`).
- `find ~/.config/FreelensDev/extension_data -path '*/pi/legacy-import-done'`
  finds one file (the helpers in S3 now work).

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### A2. A Freelens 1 install refuses this version

Preconditions: none (step 2 needs a Freelens 1.x install; skip it if there is
none).

1. `jq .engines "$EXT/package.json"`.
2. Optional: in Freelens 1.x, try to install the package built from `$EXT`
   (`pnpm pack` in `$EXT`).

Expected: `engines.freelens` is `^2.0.0` and `engines.node` is `>= 24.0.0`.
Freelens 1.x refuses the package or lists it as incompatible; none of its code
runs.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### A3. A rebuild reloads the extension once, with one agent host

Preconditions: E1 done; `pnpm dev` running in `$EXT` (S2 step 3); the chat of
`kind-lan-dev` open with a few messages.

1. Note the line count of `lens.log`: `wc -l "$(find ~/.config/FreelensDev -name lens.log | head -n 1)"`.
2. Save `src/main/index.ts` and `src/renderer/index.tsx` in `$EXT` with one
   added blank line each (revert both after the case).
3. Wait until both watch builds have finished, plus a few seconds.
4. Read the new lines of `lens.log` and the Freelens terminal.
5. Open **Freelens AI** again from the cluster sidebar and send
   "List the namespaces of this cluster."

Expected:

- One "[EXTENSIONS-LOADER]: reloading @freelensapp/ai-extension after a
  rebuild" line; no "not reloading" refusal.
- For each of `agent:command` and `provider:command`, one "[IPC-RENDERER]:
  removing extension handler" followed by one "adding extension handler"; no
  "Attempted to register a second handler" and no `[freelens-ai] Starting the
  pi agent failed`.
- The open chat page closed with the reload (the frame falls back to the
  Cluster page, as Freelens documents).
- Reopened, the chat shows the earlier messages; the new answer streams once:
  no doubled text, one answer bubble, no repeated lines.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### A4. Disabling the extension during a run

Preconditions: E1 done.

1. In the chat, send "Write a detailed, 800-word explanation of how Kubernetes
   schedules pods."
2. While the answer streams, open **File > Extensions**, the menu of the
   extension's row, **Disable**.
3. Check both logs.
4. Enable it again (the row menu item is labelled "Enabled" by Freelens) and
   open **Freelens AI** in the same cluster, without reloading the frame.
5. Send "Which cluster am I in?". Open the extension's preferences, start
   **Add provider** for any provider and cancel it.

Expected:

- The status turns **Disabled** and the "Freelens AI" sidebar entry goes.
- No `[freelens-ai]` error, no "[EXTENSIONS-LOADER]: deactivating extension
  error" and no unhandled rejection in the Freelens terminal; no error in
  DevTools.
- After enabling, the chat shows no run in progress (Send button, input
  enabled, no spinner) and the earlier messages; the interrupted answer is cut
  off or followed by "Stopped.". The answer does not continue.
- Step 5: the answer streams into the chat as usual, without reloading the
  frame; the provider dialog shows its prompt.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### A5. Upgrading from 0.7.1: old settings carried into pi

Preconditions: E1 done. Best with a real OpenAI key; otherwise a dummy key
shows the import, and the full run of step 7 uses P. If a Freelens 1 profile
with 0.7.1 exists (`~/.config/Freelens/extension-store/@freelensapp/ai-extension/`),
its files can replace the `jq` edit of step 3.

1. If an OpenAI card is shown, click its **Log out**. Quit Freelens
   (**File > Quit**).
2. `rm -f "$FAE_DATA/pi/legacy-import-done" "$FAE_DATA/pi/legacy-custom-import-done"`
3. Write the 0.7.1 fields into the preferences file:

   ```sh
   cp "$FAE_PREFS" "$FAE_PREFS.bak"
   jq '. + {openAIKey: "sk-fae-test-not-a-real-key", openAIBaseUrl: "", selectedModel: "gpt-4o-mini",
            openAIReasoningEffort: "high", podLogsRequireApproval: false, bypassApprovals: true}
       | del(.thinkingLevel, .toolApprovalOverrides, .agentModel)' "$FAE_PREFS.bak" > "$FAE_PREFS"
   ```

   With a real key, put it in place of the dummy.
4. Start Freelens (`pnpm dev`), open the extension's preferences.
5. `jq '{openAIKey, selectedModel, podLogsRequireApproval, agentModel, thinkingLevel, toolApprovalOverrides}' "$FAE_PREFS"`
6. Open the chat of `kind-lan-dev`.
7. With a real key keep `openai/gpt-4o-mini`; otherwise log out of OpenAI and
   pick M. Run D1 (read, approve and change).

Expected:

- The **OpenAI** card shows "API key saved".
- **Thinking level** is "High"; under **Tool approvals** the `getPodLogs`
  switch is off, the others as by default.
- The file shows `openAIKey`, `selectedModel` and `podLogsRequireApproval` as
  `null`, `agentModel` `"openai/gpt-4o-mini"`, `thinkingLevel` `"high"`,
  `toolApprovalOverrides` `{"getPodLogs": false}`.
- The chat's picker shows `gpt-4o-mini` under OpenAI; no chat of 0.7.1 shows;
  "Approve all in this chat" is off (the old bypass flag is not read).
- Step 7 works as in D1.

Restore afterwards: log out of OpenAI if the key was a dummy, switch
`getPodLogs` back on.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### A6. Styles in the light and the dark theme

Preconditions: E1 done; a chat with an answer, a code block and an approval
card (after D1).

1. **File > Preferences**, **App**, **Theme**: "Dark". Look at the chat page,
   an approval card, a code block, a tool call unfolded, the tool list (wrench
   button next to the input) and the extension's preferences.
2. Switch to "Light" and look at the same places.

Expected: in both themes the chat bubbles, the input, the token counter, the
context gauge, the approval card, the code blocks and the tool calls follow the
theme's colours and stay readable; the extension's preferences look like the
rest of the Preferences. The **Agent rules** text area and the tool list take
the background and text colour of the theme's input fields. Switching does not
need a reload.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### A7. Errors stay inside the chat page, the menu item and the preferences

Preconditions: E1 done; `pnpm dev` running in `$EXT`. Uses throwaway edits;
revert each with `git checkout -- <file>`.

1. Add `throw new Error("boundary check: chat page");` as the first line of the
   `MainPage` function in `src/renderer/pages/main/main-page.tsx`. After the
   reload, open **Freelens AI**, then **Pods** and **Events** in the same
   cluster. Revert.
2. Add `throw new Error("boundary check: menu item");` as the first line of
   `MenuEntry` in `src/renderer/components/menu-entry/menu-entry.tsx`. After the
   reload, open the menu of an event in **Events**. Revert.
3. Add `throw new Error("boundary check: preferences");` as the first line of
   the function in `PreferencesPage`
   (`src/renderer/pages/preferences/preferences-page.tsx`). After the reload,
   open the extension's preferences, then **App**. Revert.

Expected:

1. The chat page shows the error text "Error: boundary check: chat page" in its
   place; the sidebar, Pods and Events work.
2. The event menu shows its other items, without "Explain".
3. The extension's preferences show the error text; the other preference tabs
   work.

Each time DevTools logs "[@freelensapp/ai-extension]: Error: boundary check:
..." with the component stack. After reverting, all three work again.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

## B. Chatting

### B1. The menu entry, and "Connect a provider" in an unconfigured chat

Preconditions: A1 done; no provider connected (no card in the extension's
preferences, no provider key in the environment of Freelens).

1. Connect `kind-lan-dev` from the catalog.
2. Look at the cluster sidebar; click **Freelens AI**.
3. Click **Connect a provider**.

Expected:

- The sidebar has a "Freelens AI" entry with the extension's icon; it opens the
  chat page.
- The input shows "No AI provider is connected." and a **Connect a provider**
  button; no model picker, no token counter.
- The button opens **Preferences** at the extension's tab
  (**Extensions > @freelensapp/ai-extension**), with the block "Freelens AI
  Settings" and "No provider is connected yet. Use Add provider to connect
  one."

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### B2. Answers are grounded in the cluster; custom agent rules apply (pi 03)

Preconditions: E1 done; chat of `kind-lan-dev` open; **Agent rules** empty.

1. Send "Which cluster am I in?"
2. In the extension's preferences, write "Answer in Italian." into **Agent
   rules** and click outside the field (it saves on blur). Do not reopen the
   chat.
3. Back in the cluster, send "How many namespaces does it have?" in the same
   chat.
4. Empty **Agent rules** again and send "And how many pods are in fae-test?"

Expected: the first answer names `kind-lan-dev` as the catalog shows it. The
second answer is in Italian, the third in the language of the question again.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### B3. Streaming, reasoning, and the cluster version (pi 01)

Preconditions: E1 done; model M picked; **Thinking level** "Medium" or higher.

1. Send "Which Kubernetes version is this cluster?"
2. Watch the answer arrive. Run `fae_tools`.

Expected:

- While the model reasons, a "Reasoning" block is shown open and fills as it
  streams; when the answer text starts, it folds; clicking "Reasoning" opens it.
- The answer streams in piece by piece (not all at once at the end) and names
  the version of the kind cluster (`k version` shows it).
- `fae_tools` shows `CALL getClusterVersion {}` and its `RESULT
  getClusterVersion error=false` with the version.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### B4. Each tool call and its result in the transcript

Preconditions: B3 done.

1. Look at the transcript of B3 between the question and the answer.
2. Click the line of the call to unfold it.
3. Ask "Show me pod `fae-missing` in namespace `fae-test`." and look at the
   call it makes.
4. Reload the frame (Ctrl+R) and open **Freelens AI** again.

Expected (spec story 9):

- Between the question and the answer, one dimmed line shows the call: a
  wrench icon, `getClusterVersion` and its arguments (`{}`). While the call
  runs, a spinning icon and "running" take the place of the wrench.
- Unfolded, it shows the arguments and, under **Result**, the version text
  the tool answered.
- Step 3: the call of `getKubernetesResource` (or `listKubernetesResources`)
  shows a red icon and "failed"; unfolded, **Error** reads
  `getKubernetesResource failed: ...` with the server's message.
- Step 4: both calls are back in the same places with their results.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### B5. Stop ends a run (pi 02)

Preconditions: E1 done.

1. Send "Write a detailed, 800-word explanation of how Kubernetes schedules
   pods."
2. While it streams, look at the input, then click the square Stop button.

Expected: during the run the input is disabled with the placeholder "The agent
is working..." and Stop replaces Send. After Stop the answer ends, a dimmed
"Stopped." line follows it, the spinner goes, the input is enabled and Send is
back. No error line. (Stop during a cluster request: C10.)

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### B6. The chat survives a remount and a frame reload mid-run (pi 02)

Preconditions: E1 done.

1. Send the long prompt of B5. While it streams, open **Workloads > Pods** in
   the same cluster, wait 5 seconds, open **Freelens AI** again.
2. Send the long prompt again. While it streams, press **View > Reload**
   (Ctrl+R) with the cluster view shown. Open **Freelens AI** again if the frame
   does not come back to it.

Expected: both times the chat shows the partial answer and it continues to
stream where it was; the Stop button is there until the answer ends; no
duplicated text; the question is shown once.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### B7. The chat survives a restart of Freelens (pi 02)

Preconditions: a chat with at least two questions and answers.

1. Quit Freelens (**File > Quit**), start it again (`pnpm dev`), connect
   `kind-lan-dev`, open **Freelens AI**.
2. Send "What did I ask you first?"

Expected: the transcript is rebuilt as it was (questions and answers; a stopped
answer followed by "Stopped."). The answer to step 2 knows the earlier
conversation. Answered approval cards and AI Explain answers are not restored
(K2, K3).

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### B8. Tokens, cost and the context gauge move during a run (pi 09)

Preconditions: E1 done; a new chat (B10 step 1).

1. Look at the counter left of the model picker and the ring gauge left of
   Send; hover over both.
2. Send "List every pod in all namespaces with its status." and watch both
   during the run.
3. Send one more question.

Expected:

- Before the first answer the counter reads `in:0 (cached:0) + out:0`.
- The counter grows after each answer (and after each tool turn), in the form
  `in:X (cached:Y) + out:Z`, followed by `= $COST` when M has a price (a
  sub-cent cost shows four decimals).
- The gauge fills; its tooltip reads `Conversation context: USED / WINDOW
tokens (N%)` with M's context window.
- New chat sets the counter back to `in:0 (cached:0) + out:0`.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### B9. Compaction

Preconditions: E1 done; P is a built-in pi provider and M its model id (as in
the `agentModel` preference, `provider/id`).

1. Quit Freelens. Give M a small context window in pi's `models.json`
   (keep a copy; create the file with `{"providers": {}}` if missing):

   ```sh
   cp "$FAE_DATA/pi/models.json" "$FAE_DATA/pi/models.json.bak" 2>/dev/null || echo '{"providers": {}}' > "$FAE_DATA/pi/models.json"
   jq --arg p "<provider id>" --arg m "<model id>" \
     '.providers[$p].modelOverrides[$m].contextWindow = 40000' "$FAE_DATA/pi/models.json" > /tmp/models.json \
     && mv /tmp/models.json "$FAE_DATA/pi/models.json"
   ```

2. Start Freelens; open a new chat of `kind-lan-dev`.
3. Send "Get the full YAML of every pod in kube-system, one by one." and then
   "Now do the same for every deployment in kube-system." until pi compacts
   (past about 24,000 tokens of context: the 40,000 window less pi's reserve of
   16,384).
4. Reopen the chat with **View > Reload**.

Expected: a dimmed line "Compacting the conversation to free up context..."
appears, then becomes "Compacted the conversation: earlier messages were
summarized to free up context."; the run continues. Right after it the gauge's
tooltip says the context is unknown until the next answer. After the reload the
earlier messages and the compaction line are still there.

Restore afterwards: quit Freelens, put `models.json.bak` back (or delete the
file if it did not exist).

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### B10. New chat, Delete all chats and the retention setting (pi 06)

Preconditions: E1 done; a chat with messages.

1. Click **New chat** (the speech bubble with a plus).
2. Send "Hello", then quit and restart Freelens and open the chat.
3. `ls -l "$(dirname "$(fae_chat)")"`
4. Make the older chat look three days old (pi reads the age from the message
   times, not the file time):

   ```sh
   OLD=<the older .jsonl of step 3>
   jq -c --argjson t "$(( ($(date +%s) - 3 * 86400) * 1000 ))" \
     'if .type == "message" then .message.timestamp = $t else . end' "$OLD" > /tmp/old.jsonl && mv /tmp/old.jsonl "$OLD"
   ```

   Set **Delete chats older than N days** to `1` and click outside the field.
   Click **New chat**, then run step 3 again.
5. Click **Delete all chats** (the bin), answer the confirmation, run step 3
   again, restart Freelens and open the chat.
6. Set **Delete chats older than N days** back to `30`.

Expected:

1. The transcript empties, the counter is back to zero; New chat is disabled
   while the chat is empty.
2. After the restart the chat shows "Hello" and its answer, not the earlier
   chat.
3. The folder holds the old chat and the new one.
4. The file made old is deleted; the "Hello" chat is kept.
5. The confirmation reads "Delete all saved chats of this cluster? This cannot
   be undone."; the transcript empties; the cluster's folder is gone; after the
   restart the chat is empty.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### B11. Code blocks: editor, Copy, Run and the managed fields toggle

Preconditions: E1 done.

1. Send "Give me the kubectl command that lists the pods of fae-test, as a
   bash code block, nothing else."
2. Click Copy (top right of the block) and paste somewhere.
3. Click the green play button (top left).
4. Send "Get the deployment web in fae-test with includeManagedFields true and
   print the whole object as a yaml code block."
5. Click the managed fields button next to Copy, twice.

Expected:

1. The block renders in the Freelens editor (Monaco, read-only), labelled
   `bash`, with a play button.
2. "Copied!" shows briefly; the clipboard holds the command.
3. A terminal tab "FreeLens AI" opens and runs the command against the cluster.
4. The YAML renders in the editor with YAML highlighting; `managedFields` is
   hidden at first.
5. The button (tooltip "Show managedFields") shows the `managedFields` block;
   clicked again ("Hide managedFields") it hides it.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

## C. Cluster tools

All tool results are read with `fae_tools` (S3) after the answer.

### C1. Namespaces, cluster version and warning events (pi 04)

Preconditions: S4 objects created; E1 done.

1. Send "What is failing in namespace fae-test?"
2. Run `fae_tools`.

Expected: the calls include `getWarningEventsByNamespace` with
`{"namespace":"fae-test"}` and `listKubernetesResources` (pods), all with
`error=false`. The answer names `bad-image` (image pull failure), `crashy`
(restarts) and the `FaeTestWarning` event. `getNamespaces` and
`getClusterVersion` are covered by B2 and B3.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### C2. Any kind, a custom resource with an irregular plural (pi 04)

Preconditions: S4 objects created. Optional step 3 needs the Gateway API CRDs:
`k apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.2.1/standard-install.yaml`
and a Gateway `fae-gw` in `fae-test` (`gatewayClassName: none`, one HTTP
listener on port 80).

1. Send "List the Octopus resources (apiVersion test.freelens.app/v1) in
   fae-test and tell me how many arms paul has."
2. Send "List the ingresses and the ConfigMaps in kube-system."
3. Optional: "Get the Gateway fae-gw in fae-test, apiVersion
   gateway.networking.k8s.io/v1."

Expected: `fae_tools` shows `listKubernetesResources` or
`getKubernetesResource` with kind `Octopus` and the result holding `paul` with
`arms: 8` (not "Could not resolve a Kubernetes API"); the answer says 8. The
built-in kinds of step 2 and the Gateway of step 3 come back without error.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### C3. Pod logs: the running container unless the previous one is asked for

Preconditions: `crashy` restarted at least once and running again:
`k -n fae-test get pod crashy` shows RESTARTS >= 1 and STATUS Running.
Compare `k -n fae-test logs crashy` with `k -n fae-test logs crashy --previous`.

1. Send "Show me the logs of pod crashy in fae-test." Approve the card.
2. Send "Now show me the logs of the previous instance of crashy." Approve.

Expected: the card is titled "READ LOGS POD" (pod logs ask by default). The
first answer quotes the "instance started at" time of the running container
(as `kubectl logs`), the second the times of the terminated one (as
`kubectl logs --previous`), with its "instance exiting" line. In `fae_tools` the
first call has no `"previous":true`.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### C4. Pod logs: filter and the tail lines preference

Preconditions: `chatty` running.

1. In the extension's preferences set **Pod logs > Default tail lines** to
   `20`. Do not reopen the chat.
2. Send "Read the logs of pod chatty in fae-test and show them to me
   verbatim." Approve.
3. Send "Show me only the ERROR lines of chatty." Approve.
4. Set **Default tail lines** back to `1000`.

Expected: `fae_tools`: the result of step 2 holds at most 20 lines (unless the
model asked for a `tailLines` itself); the call of step 3 has a `filter` such as
`"ERROR"` and its result holds only `ERROR request ... failed` lines.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### C5. Create, update and patch, and a change of a missing object

Preconditions: E1 done; default approval settings.

1. Send "Create a ConfigMap fae-cm in fae-test with data color=blue." Approve.
2. Send "Update the ConfigMap fae-cm (a full update) so that its data is
   color=green and size=small." Approve.
3. Send "Patch the ConfigMap fae-cm to add shape=round." Approve.
4. Send "Update the ConfigMap does-not-exist in fae-test so its data is a=b."
   Approve.
5. `k -n fae-test get configmap fae-cm -o jsonpath='{.data}'`

Expected:

- Cards titled "CREATE CONFIGMAP" (no "Resources that will be changed" block),
  "UPDATE CONFIGMAP" and "PATCH CONFIGMAP" (both with it).
- Results `ConfigMap "fae-cm" created successfully`, `... updated
  successfully`, `... patched successfully`; step 5 shows color green, size
  small, shape round.
- Step 4: the card has no backup block; the Freelens terminal shows
  `[freelens-ai] Loading the backup for the updateKubernetesResource approval
  failed: ...`; the result is `updateKubernetesResource failed: configmaps
  "does-not-exist" not found` (error=true), and the answer says it does not
  exist.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### C6. Scale through the subresource; restart (pi 05 is D1)

Preconditions: deployment `web` at 1 replica.

1. Send "Scale the deployment web in fae-test to 3 replicas." Approve.
2. `k -n fae-test get deploy web`
3. Send "Restart the deployment web in fae-test." Approve.
4. `k -n fae-test get deploy web -o jsonpath='{.spec.template.metadata.annotations}'; k -n fae-test get rs`

Expected: the scale card is "PATCH DEPLOYMENT" with `subresource: scale` in
"Action details"; the result is `Deployment "web" scale subresource patched
successfully`; step 2 shows 3/3. The restart card is "RESTART DEPLOYMENT", the
result `Deployment "web" restarted successfully`; step 4 shows a
`kubectl.kubernetes.io/restartedAt` annotation and a new ReplicaSet.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### C7. Delete a resource: delete, force delete, force finalize

Preconditions: `fae-cm` from C5.

1. Send "Delete the ConfigMap fae-cm in fae-test." Approve.
2. Create two more: `k -n fae-test create configmap fae-cm2` and
   `k -n fae-test create configmap fae-stuck-cm`, then
   `k -n fae-test patch configmap fae-stuck-cm --type=merge -p '{"metadata":{"finalizers":["test.freelens.app/block"]}}'`
   and `k -n fae-test delete configmap fae-stuck-cm --wait=false`.
3. Send "Force delete the ConfigMap fae-cm2 in fae-test." Approve.
4. Send "The ConfigMap fae-stuck-cm in fae-test is stuck deleting; clear its
   finalizers (force_finalize)." Approve.
5. `k -n fae-test get configmap`

Expected: cards "DELETE CONFIGMAP" with `mode: delete`, `mode: force_delete`
and `mode: force_finalize`, each with the backup; results `ConfigMap "fae-cm"
deleted successfully`, `ConfigMap "fae-cm2" force-deleted successfully`,
`ConfigMap "fae-stuck-cm" finalizers cleared successfully`; step 5 lists none
of the three.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### C8. Delete a pod: evict and force delete

Preconditions: `web` running (any replica count).

1. Send "Evict one pod of the deployment web in fae-test." Approve.
2. Send "Force delete another pod of web." Approve.
3. `k -n fae-test get pods -l app=web`

Expected: cards "DELETE POD (evict)" and "DELETE POD (force_delete)" with the
pod's YAML as backup; results `Pod "<name>" evicted successfully` and
`Pod "<name>" force-deleted successfully`; the deployment has replaced both.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### C9. A pod stuck in Terminating goes away with its finalizers

Preconditions: `stuck-pod` created and stuck in Terminating (S4).

1. Send "The pod stuck-pod in fae-test is stuck in Terminating. Delete it
   together with its finalizers." Approve the card.
2. `k -n fae-test get pod stuck-pod`
3. Run `fae_tools` and read the answer.

Expected:

- The card is "DELETE POD (delete_with_finalizers)" with the pod's YAML (its
  `finalizers` and `deletionTimestamp`) as backup.
- Step 2: `Error from server (NotFound)`.
- The result is either `Pod "stuck-pod" deleted and finalizers cleared
  successfully`, or (the pod went as soon as its finalizers were cleared) the
  error `deletePod failed: The finalizers of Pod "stuck-pod" were cleared.
  Deleting it failed: pods "stuck-pod" not found`.
- The answer matches the result and step 2: the pod is gone. It never says the
  pod is gone while step 2 still finds it, nor the reverse.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### C10. Stop during a cluster request; no fixed timeout

Preconditions: E1 done. Keep the pause short (under a minute).

1. `docker pause lan-dev-control-plane`
2. Send "List the namespaces of this cluster."
3. Wait 40 seconds; then click Stop.
4. `docker unpause lan-dev-control-plane`, wait 30 seconds, run `fae_tools`.

Expected: during step 3 the run keeps waiting (spinner, Stop) past 30 seconds:
the frame tools' 30-second "did not answer" result is gone, and there is no
fixed timeout. Stop ends the run within a few seconds: Send is back and the
input enabled (a "Stopped." line may follow). After the unpause no further call
or answer appears; the last `getNamespaces` call has an error result or none.
No `[freelens-ai]` error in the terminal.

If the call answered `Cluster not connected` at once, Freelens had already
marked the cluster disconnected: unpause, reconnect, and repeat with step 2
right after step 1.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### C11. A cluster that is not connected answers "Cluster not connected"

Preconditions: E1 done; default approvals (the prompt uses reads that do not
ask).

1. Send "For every namespace, one at a time, list its pods, then its warning
   events, then the services. Use one tool call per step and comment on each
   result before the next call."
2. After the first two or three calls (watch `fae_tools`), disconnect
   `kind-lan-dev` from the catalog (its menu, **Disconnect**). Wait one minute.
3. Check the catalog; run `fae_tools`.
4. Connect the cluster again and open **Freelens AI**.

Expected: the cluster stays disconnected in the catalog until step 4 (the
assistant does not connect it). Calls after the disconnect have the result
`Cluster not connected` with `error=true` (one call may fail with a
connection error instead, if it was in flight). In step 4 the chat shows the
run and an answer that says the cluster was not connected.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### C12. The frame reloads while an approved write is in progress

Preconditions: E1 done; `web` at 3 replicas.

1. Send "Scale the deployment web in fae-test to 2 replicas." Wait for the card
   (with its backup).
2. `docker pause lan-dev-control-plane`, then click **yes** on the card.
3. Press **View > Reload** (Ctrl+R) in the cluster view.
4. `docker unpause lan-dev-control-plane`; open **Freelens AI** again when the
   cluster view is back.
5. `k -n fae-test get deploy web`

Expected: the write completes: step 5 shows 2 replicas; the chat shows the
answer that reports the scale; `fae_tools` has `Deployment "web" scale
subresource patched successfully`. No "reloaded while pending, outcome unknown"
result, no duplicate call.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### C13. The assistant's reads leave the Freelens lists alone

Preconditions: E1 done.

1. Open **Workloads > Pods** and set the namespace filter to `fae-test` only.
   Note the rows.
2. In the chat, send "List all pods in all namespaces, and all ConfigMaps in
   kube-system."
3. Go back to **Workloads > Pods**.

Expected: the Pods list still shows only `fae-test`, with the same rows and the
same namespace filter; no other list changed.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### C14. Failed requests in plain words: not found, forbidden, not served

Preconditions: the viewer context of S4 synced; connect `kind-lan-dev-viewer`
in the catalog.

1. In the chat of `kind-lan-dev`, send "Get the pod does-not-exist in
   fae-test."
2. Send "List the Widget resources with apiVersion example.com/v1."
3. In the chat of `kind-lan-dev-viewer`, send "List the secrets in fae-test."
4. There, send "Restart the deployment web in fae-test." Approve.

Expected: results (error=true where a request failed):

1. `getKubernetesResource failed: pods "does-not-exist" not found`.
2. `Could not resolve a Kubernetes API for kind "Widget" and apiVersion
   "example.com/v1".`
3. `listKubernetesResources failed: secrets is forbidden: User
   "system:serviceaccount:fae-test:fae-viewer" cannot list resource "secrets"
   ...`.
4. `restartKubernetesResource failed: deployments.apps "web" is forbidden: ...`.

Each answer explains the failure in plain words and does not retry in a loop.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

## D. Approvals

### D1. Every change waits; the card shows the change and the backup (pi 05)

Preconditions: E1 done; the extension's **Tool approvals** at their defaults
(after A5, D3: switch back).

1. In **Tool approvals**, check the switches.
2. Send "Scale the deployment web in fae-test to 4 replicas."
3. Look at the card as soon as it appears; expand "Resources that will be
   changed".
4. Click **no**. Check `k -n fae-test get deploy web`.
5. Send "Please try again." Click **yes**. Check again.

Expected:

1. Every tool marked "Changes the cluster" and `getPodLogs` have **Requires
   approval** on; the other five reads off.
2. The run pauses with a card: header "PATCH DEPLOYMENT" with a warning sign,
   "Action details" (expanded, YAML with `action`, `name`, `namespace`,
   `subresource: scale`, `data`), "Resources that will be changed" (collapsed),
   the question "Do you want to approve this action?" and the buttons **yes**,
   **no** and **Approve all in this chat**.
3. Both blocks are there from the start (the backup does not appear later);
   the backup is the current deployment as YAML (apiVersion, kind, metadata,
   spec, status).
4. The card turns into a red cross with the header; nothing changes;
   `fae_tools` shows the result "The user denied the action" (error=true).
5. A new card; after **yes** a green check; 4 replicas. Clicking an answered
   card's header shows its details again.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### D2. "Approve all in this chat" (pi 07)

Preconditions: E1 done; a new chat.

1. Send "Scale web in fae-test to 2 replicas." On the card click **Approve all
   in this chat**.
2. Send "Now scale it to 3, then restart it."
3. Reload the frame (Ctrl+R) and reopen the chat.
4. Click **Turn off** in the notice.
5. Send "Scale web to 1 replica."
6. Click **Approve all in this chat** on that card, then **New chat**, and send
   "Scale web to 2 replicas."

Expected:

1. The change runs; a notice "Approving all actions in this chat" with a
   **Turn off** button appears above the chat.
2. Both changes run without a card (`k -n fae-test get deploy web` shows 3,
   then a new ReplicaSet).
3. The notice is still there after the reload.
4. The notice goes.
5. A card appears again.
6. After New chat the notice is gone and the change asks again.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### D3. Per-tool approval settings (pi 08)

Preconditions: E1 done; chat page open.

1. In the extension's preferences, **Tool approvals**, switch **Requires
   approval** off for `restartKubernetesResource`. Do not reopen the chat.
2. Send "Restart the deployment web in fae-test."
3. Switch `getClusterVersion` on, send "Which Kubernetes version is this?"
4. Restart Freelens and look at **Tool approvals**.
5. Switch both back to their defaults.

Expected: the restart runs without a card (new ReplicaSet); the version read
asks with a card titled "GETCLUSTERVERSION"; after the restart both switches
keep their state; the preferences file has only the changed tools in
`toolApprovalOverrides`.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### D4. Stop and New chat deny a pending approval

Preconditions: E1 done; default approvals.

1. Send "Scale web in fae-test to 5 replicas." When the card shows, click Stop.
2. Send "Scale web in fae-test to 5 replicas." When the card shows, click **New
   chat**.
3. `k -n fae-test get deploy web`

Expected: after Stop the card turns denied (red cross) and the run ends (Send
is back; a "Stopped." line may follow); after New chat the transcript empties;
in both cases the replica count does not change, also not later.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### D5. A frame reload with a pending approval

Preconditions: E1 done; default approvals.

1. Send "Restart the deployment web in fae-test." Wait for the card.
2. Press **View > Reload** (Ctrl+R); reopen **Freelens AI**.
3. Expand "Resources that will be changed"; click **yes**.

Expected: the pending card is back with both blocks, the backup included; Stop
is shown; **yes** runs the restart and the run ends with an answer.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

## E. Providers, models and network

### E1. Connect a provider with an API key; log out (pi 10)

Preconditions: B1 done. P with an API key (best: OpenAI, as the pi ticket asks).
If P is a subscription only, do E2 instead and come back for step 5.

1. Extension's preferences: click **Add provider**, type the provider's name in
   the search, pick it.
2. If asked `How do you want to connect NAME?`, click the API key method.
   Paste the key, click **Continue**.
3. Look at the card, then at the chat of `kind-lan-dev` (still open).
4. `grep -c "<first 12 characters of the key>" "$FAE_PREFS"`
5. With a second key-based provider, or after E2: click **Log out** on one card.

Expected:

- The picker says `Search N providers...`; the dialog is titled
  `Connect NAME`; the key field hides its input.
- A card appears with the provider's name, "API key saved", a log-out icon
  (tooltip "Log out"), up to 8 models with context size and price
  (`128k - $x / $y`, or "no price listed"), and `Show all N models` when there
  are more.
- In the open chat, without reopening it, the "No AI provider is connected."
  line is replaced by the model picker and the counter.
- Step 4 prints `0`.
- After **Log out** the card goes and its models leave the picker of the open
  chat.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### E2. A subscription login opens in the browser (pi 10)

Preconditions: an account of a subscription provider pi supports (for example
GitHub Copilot, Claude Pro/Max, ChatGPT Plus/Pro). Otherwise Blocked.

1. **Add provider**, pick it, choose the method marked "(subscription)".
2. Finish the sign-in in the browser (or enter the shown code on the page it
   names).
3. Repeat step 1 and click **Cancel login** before finishing.

Expected: the system browser opens the sign-in page by itself (once; "Open the
sign-in page again" opens it again), or the dialog shows `Open LINK and enter
this code:` with the code. After signing in, the dialog closes and a card shows
"Signed in" with the models. Cancelling closes the dialog without an error and
without a new card.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### E3. A key from an environment variable

Preconditions: a provider not connected yet, for example Anthropic.

1. Quit Freelens; start it from the `freelens/` folder with the variable set
   (see [Environment](#environment)), for example
   `ANTHROPIC_API_KEY=sk-ant-dummy pnpm dev`.
2. Open the extension's preferences.
3. Quit, and start Freelens without the variable again.

Expected: in step 2 the provider has a card "From ANTHROPIC_API_KEY" without a
log-out icon; the existing cards are unchanged. In step 3 that card is gone.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### E4. A custom OpenAI-compatible endpoint (pi 11)

Preconditions: an OpenAI-compatible server with a tool-calling model, for
example Ollama:
`docker run -d --name fae-ollama -p 11434:11434 ollama/ollama` and
`docker exec fae-ollama ollama pull qwen2.5:3b`. Otherwise Blocked.

1. Click **Add custom endpoint**. Click **Add endpoint** with every field
   empty.
2. Fill **Name** `Local Ollama`, **Base URL** `http://localhost:11434/v1`, no
   key, **Model ids** `qwen2.5:3b`; click **Add endpoint**.
3. Note the `models.json` path shown under the cards; `jq . <that path>`.
4. In the chat, pick `qwen2.5:3b` under "Local Ollama"; send "List the
   namespaces of this cluster."
5. Click the bin icon of the card ("Remove endpoint"), confirm.

Expected:

1. The error line "Enter a name for the endpoint." shows; nothing is added.
   (With a name but no model id: "Enter at least one model id.")
2. A card "Local Ollama" with `Custom endpoint - http://localhost:11434/v1`,
   the model, and a bin icon instead of log out.
3. The file has the provider with `baseUrl`, `api` `openai-completions` and the
   model.
4. The answer comes from the local model and lists the namespaces.
5. The confirmation reads "Remove Local Ollama? Its saved API key is deleted
   too."; the card and its model in the picker go; the entry leaves
   `models.json`.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### E5. The model picker with two providers (pi 12)

Preconditions: two providers connected (two of E1, E2, E3 or E4). Otherwise
Blocked.

1. Open the picker in the chat.
2. Pick a model of provider A; send "Which model are you, and which company
   made you?"
3. Pick a model of provider B in the same chat; send the same question.
4. Restart Freelens and open the chat.
5. Log out of provider B (or remove it) with the chat open in the cluster view.

Expected: the picker groups the models under their provider names. Each answer
comes from the model picked before it
(`jq -r 'select(.type == "model_change") | "\(.provider)/\(.modelId)"' "$(fae_chat)"`
lists A's model, then B's).
After the restart the picker shows the last model picked. After step 5 B's
models leave the picker without reopening the chat; if B's model was picked,
the picker shows "Choose a model".

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### E6. The thinking level

Preconditions: model M picked.

1. Extension's preferences: **Thinking level** "Off". Send "What is 17 * 23?
   Think it through."
2. Set "High" (no reopening). Send the same.
3. Pick a model without reasoning, if P has one, send a question; pick M again
   and send the same question.

Expected: "Off" gives no "Reasoning" block; "High" gives one. After the detour
through a model without reasoning, M reasons again (the level is set on every
prompt). The select offers Off, Minimal, Low, Medium, High, Extra high.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### E7. The chat follows the Freelens HTTPS proxy and CA settings

Preconditions: `mitmproxy` available, for example
`docker run --rm -it -p 127.0.0.1:8080:8080 -v ~/.mitmproxy:/home/mitmproxy/.mitmproxy mitmproxy/mitmproxy mitmdump --listen-host 0.0.0.0`
(it writes its CA to `~/.mitmproxy/mitmproxy-ca-cert.pem`). P is not a Google,
Bedrock or Codex provider (those are E8).

1. **File > Preferences > Proxy**: **HTTP Proxy** `http://127.0.0.1:8080`
   (saved on blur); **Allow untrusted Certificate Authorities** off.
2. Send "Hello" in the chat. Watch `mitmdump`.
3. Switch **Allow untrusted Certificate Authorities** on; click Retry (or send
   "Hello" again).
4. Switch it off. Trust the mitmproxy CA in the system store
   (`sudo cp ~/.mitmproxy/mitmproxy-ca-cert.pem /usr/local/share/ca-certificates/fae-mitmproxy.crt && sudo update-ca-certificates`),
   restart Freelens, send "Hello" again.
5. Send "Explain this: Back-off restarting failed container" via F1's menu
   item instead, with the proxy still set.

Expected:

2. `mitmdump` shows a failed client TLS handshake for P's API host; the chat
   shows a provider error ("Provider error: ... Retrying in N s (attempt a of
   m)." lines and then "Error while running Freelens Agent: ..." with Retry).
3. The answer arrives; `mitmdump` lists the model request (for example
   `POST https://api.openai.com/...`).
4. The answer arrives through the proxy without the untrusted switch.
5. AI Explain's request goes through the proxy too.

Undo: clear **HTTP Proxy**; `sudo rm /usr/local/share/ca-certificates/fae-mitmproxy.crt && sudo update-ca-certificates --fresh`.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### E8. Requests that do not use the Freelens proxy are documented

Preconditions: the proxy of E7 set, `mitmdump` running; a Google (Gemini) key,
an Amazon Bedrock login or a ChatGPT sign-in for steps 2 and 3, otherwise those
steps are Blocked.

1. Read the README and `AGENTS.md` of `$EXT` for the proxy settings.
2. Chat with a Google model.
3. Chat with a Bedrock model, or an `openai-codex` (ChatGPT sign-in) model.
4. Start a subscription login (E2) and cancel it.

Expected: the documents say that requests to Google Generative AI and Google
Vertex models, Bedrock, Codex's WebSocket transport, OAuth logins and
model-list refreshes do not use the Freelens proxy and CA settings. Steps 2 to 4
show no request in `mitmdump` (Codex: none, unless its WebSocket fails and it
falls back to the proxied request); the chat works if the direct connection
does.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### E9. Keys and tokens stay in the main process

Preconditions: E1 done (and E2 if available).

1. `grep -rl "<first 12 characters of the key>" ~/.config/FreelensDev --exclude-dir=extension_data`
2. `jq 'keys' "$FAE_DATA/pi/auth.json"` (names only, do not print values).
3. In DevTools, look for the key in the console output of a chat run and a
   login (Ctrl+F in the console).

Expected: step 1 finds no file (in particular not the preferences file, not
`lens.log`); step 2 lists the connected providers; step 3 finds nothing.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### E10. pi 1.4.0 is in the build

Preconditions: S2 done.

1. `jq -r .version "$EXT"/node_modules/@earendil-works/pi-coding-agent/package.json "$EXT"/node_modules/@earendil-works/pi-ai/package.json`

Expected: `1.4.0` twice. The chat cases above run on it.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

## F. AI Explain and preferences

### F1. "Explain" on a warning event (pi 13)

Preconditions: E1 done; the event `fae-test-warning` exists (S4); the chat of
`kind-lan-dev` has saved messages.

1. Open **Events** in the cluster, find the "FaeTestWarning" event, open its
   menu (the row's menu, or the toolbar of its details).
2. Click **Explain**.
3. Run `wc -l "$(fae_chat)"` before and after the explanation.
4. While the next explanation streams (repeat 1 and 2 with a `bad-image`
   warning), click Stop.
5. Send a long chat prompt, and while it runs use **Explain** on an event.

Expected:

1. The menu has an **Explain** item with the extension's icon.
2. The chat page opens with the message "Could you explain this message?"
   followed by the event message, and the answer streams with the headings
   Summary, Diagnosis, Impact Assessment, Recommended Actions and Reference
   Material (some may be skipped), no emoji.
3. The chat file has the same line count (the explanation is not saved).
4. The explanation stops with "Stopped.".
5. An error line "Error in AI analysis: Wait for the current answer to finish,
   or stop it, before asking for an explanation." with Retry.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### F2. Every preference is shown, saved and followed without reopening

Preconditions: E1 done; the chat of `kind-lan-dev` open in the cluster view.

1. Open the extension's preferences. Check the sections: Providers, Thinking
   level, Agent rules, Chats ("Delete chats older than N days"), Tool
   approvals, Pod logs ("Default tail lines").
2. Change each once: thinking level, an agent rule (click outside), retention
   days (click outside), one approval switch, the tail lines.
3. Restart Freelens and open the preferences again; `jq . "$FAE_PREFS"`.
4. Set everything back.

Expected: all sections are shown. Each change takes effect in the open chat
without reopening it (B2, C4, D3, E6 and B10 show it per setting). After the
restart every value is as set, in the page and in the file.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

## G. Several clusters

### G1. Two clusters at once, each with its own chat

Preconditions: `kind-lan-dev` and a second catalog cluster connected
(`kind-lan-dev-viewer` from S4, or a second kind cluster:
`kind create cluster --name lan-dev-2`).

1. In cluster A, open **Freelens AI**, send "Remember the word apple."
2. Switch to cluster B, open **Freelens AI**.
3. In B, send "Which word did I ask you to remember?" and, while it streams,
   switch to A and send "Which cluster am I in?".
4. Switch between A and B.
5. In B pick another model in the picker; switch to A.

Expected: B's chat does not show A's messages; B's answer does not know
"apple". Both runs stream at the same time, each in its own chat; each answer
names its own cluster. No message of one chat shows in the other at any time.
The model picker is shared: A shows the model picked in B (the last model used).

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

## H. Maintainer checks

### H1. Stack, type-check programs and the bundle check

Preconditions: `$EXT` checked out, `nvm use`.

1. `pnpm install --frozen-lockfile && pnpm type:check && pnpm biome:check && pnpm test:unit && pnpm build && pnpm knip:check`
2. `git diff origin/main -- vite.config.mjs build/vite-plugin-*.mjs tsconfig.base.json src/*/tsconfig.json environment-tests biome.jsonc mise.toml .github/workflows`
3. Add `import { readFileSync } from "node:fs";` and a use of it to a file in
   `src/renderer/`, and `document.title` to a file in `src/main/`; run
   `pnpm type:check:sources`; revert.

Expected: step 1 passes, its build ending with the checks of the built output
(the main bundle loads in plain Node). Step 2 shows only the differences the
plan record lists (the `codeSplitting` lines of `vite.config.mjs`), plus what
Renovate changed on `main` since, until ticket 14 merges it. Step 3 fails on
both lines.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### H2. AGENTS.md and the README describe the pi agent on v2

Preconditions: ticket 12 merged.

1. Read the README and `AGENTS.md` of `$EXT`.

Expected: the README states the Freelens 2 requirement, the build, the install
from the directory and the development loop. `AGENTS.md` describes the agent
host, the IPC protocol, the cluster tools in main, the Freelens HTTP client and
its gaps, as the code is, and tells no history.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

### H3. One commit per step

1. `git log --oneline --first-parent piagent` from before ticket 01 on.

Expected: one commit per ticket (or its merge), with plain descriptive
subjects, no `fix:`/`feat:` prefixes, no emoji.

Result: [ ] Pass [ ] Fail [ ] Blocked. Notes:

## Known gaps

Behaviour of the code at the time of writing that makes a case fail or look
odd. Report a case as failed only for something not listed here.

- **K1. Fixed: tool calls are shown in the chat.** The chat reducer folds
  pi's `tool_execution_*` events, and the snapshot's tool-call parts and tool
  results, into a line per call (B4). The other cases still name `fae_tools`
  to read the calls and results in the session file, which shows them in
  full.
- **K2. AI Explain answers are not in the pi session**, so a chat rebuilt from
  a snapshot that has saved messages (frame reload, restart) drops them (pi
  13).
- **K3. Answered approval cards are not in the pi session** and are gone after
  a rebuild from a snapshot; a pending card comes back (pi 05).
- **K4. A restart of Freelens drops a pending approval** (accepted in the pi
  agent build).
- **K5. Fixed: the agent rules text area and the tool list follow the theme.**
  Both take the theme's input field colours instead of their dark inline ones
  (A6).
- **K6. After picking another model, the gauge keeps the previous model's
  context window** until the next answer's stats arrive (pi 09).
- **K7. Fixed: the renderer clients restart after Disable and Enable.** The
  renderer extension's `onDeactivate` stops the agent and provider clients,
  so the next activation, in the module already loaded, listens again and
  loads a new snapshot (A4 step 5).

## Mapping

### User stories of the spec

| Story                                               | Cases              |
| --------------------------------------------------- | ------------------ |
| 1. Accepted at install                              | A1                 |
| 2. Loads without errors in either process           | A1, A3             |
| 3. Not installable on Freelens 1                    | A2                 |
| 4. 0.7.1 key, base URL and model carried into pi    | A5, E4 (base URL)  |
| 5. Styles in light and dark theme                   | A6                 |
| 6. "Freelens AI" menu entry with icon               | B1                 |
| 7. Answers grounded in this cluster                 | B2, G1             |
| 8. Streaming with reasoning                         | B3, E6             |
| 9. Tool calls and results in the transcript         | B4                 |
| 10. Stop, also during a cluster request             | B5, C10            |
| 11. Chat restored on reopening, even mid-run        | B6, D5             |
| 12. Chat survives a restart                         | B7                 |
| 13. Each cluster frame shows only its chat          | G1                 |
| 14. Tokens, cost, gauge, compaction line            | B8, B9             |
| 15. New chat and Delete all chats                   | B10                |
| 16. "Connect a provider" opens the preferences tab  | B1                 |
| 17. Code blocks: editor, Copy, Run, managed fields  | B11                |
| 18. Namespaces, version, warning events             | B2, B3, C1         |
| 19. Any kind, custom resources, irregular plurals   | C2                 |
| 20. Logs of the running container unless previous   | C3                 |
| 21. Logs filter and tail lines preference           | C4                 |
| 22. Create, update, patch, scale, delete, restart   | C5, C6, C7, C8, C9 |
| 23. Delete a pod with its finalizers really         | C9                 |
| 24. "Cluster not connected"                         | C11                |
| 25. Tools keep working through a frame reload       | C12                |
| 26. Reads leave the Freelens lists alone            | C13                |
| 27. Failed requests explained                       | C5, C14            |
| 28. Every change waits for approval by default      | D1                 |
| 29. Card shows the change and the backup together   | D1, D5             |
| 30. Approve, deny, approve all, per-tool settings   | D1, D2, D3         |
| 31. Stop and New chat deny a pending approval       | D4                 |
| 32. Any pi provider, API key or subscription        | E1, E2             |
| 33. Sign-in page opens in the browser               | E2                 |
| 34. Providers, custom endpoints, env keys shown     | E1, E3, E4         |
| 35. Chat uses the Freelens proxy and CA settings    | E7                 |
| 36. Google requests bypass the proxy, documented    | E8                 |
| 37. Keys and tokens stay in main                    | E9                 |
| 38. Model picker and thinking level                 | E5, E6             |
| 39. pi 1.4.0                                        | E10                |
| 40. Explain on a warning event                      | F1                 |
| 41. Every preference shown, saved, followed live    | F2, B2, B10, C4, D3, E6 |
| 42. Errors stay inside page, menu item, preferences | A7                 |
| 43. Directory install, rebuild reloads              | A1, A3             |
| 44. One agent host and handler per channel          | A3                 |
| 45. Disable during a run stops it cleanly           | A4                 |
| 46. Stack identical to the `main` branch            | H1                 |
| 47. Separate type-check programs                    | H1                 |
| 48. Main bundle loads in plain Node                 | H1                 |
| 49. AGENTS.md and README describe v2                | H2, E8             |
| 50. A list of manual test cases                     | this document      |
| 51. One commit per step                             | H3                 |

### Pending manual checks of the pi agent build tickets

| Ticket and HITL check                                                       | Cases                  |
| --------------------------------------------------------------------------- | ---------------------- |
| 01. "Which Kubernetes version is this cluster?" streams after `getClusterVersion` | B3               |
| 02. Long answer survives close and reopen; Stop shows "Stopped."; restart rebuilds | B5, B6, B7     |
| 03. "Which cluster am I in?"; "Answer in Italian" rule applies next message | B2                     |
| 04. "What is failing in namespace X?" lists resources and warning events; Gateway API with explicit apiVersion | C1, C2 |
| 05. Scale a deployment: card with both YAML blocks, deny once, approve once | D1, C6                 |
| 06. New chat and Delete all chats from the chat UI                          | B10                    |
| 07. Approve all, notice, two changes without card, turn off, asks again     | D2                     |
| 08. Approval off for `restartKubernetesResource`: restart without card      | D3                     |
| 09. Counter and gauge move during a run with a real model                   | B8                     |
| 10. OpenAI with a key, a subscription in the browser, log out, cards update | E1, E2                 |
| 11. OpenAI-compatible endpoint (Ollama, LiteLLM) and chat                   | E4                     |
| 12. Two providers' models in one chat; logout removes models from picker    | E5, E1                 |
| 13. AI Explain streams a structured answer                                  | F1                     |
| 14. Upgrade with old OpenAI key: key carried, old chats gone, full run works | A5, D1, C6            |

### Functional checks of the plan record

| Functional check (`plan.md`)                                        | Cases                          |
| ------------------------------------------------------------------- | ------------------------------ |
| Accepted at discovery, loads without error                          | A1                             |
| Rebuild reloads, one agent host and handler per channel             | A3                             |
| Preference followed through mobx without reopening                  | F2                             |
| Menu entry opens the chat                                           | B1                             |
| Streaming, reasoning, tool calls, tokens, cost, gauge, compaction   | B3, B4, B8, B9                 |
| Stop (also a cluster request), New chat, Delete all chats           | B5, C10, B10                   |
| Reopen mid-run, restart, two clusters                               | B6, B7, G1                     |
| "Connect a provider"                                                | B1                             |
| Code blocks                                                         | B11                            |
| Read and write tools; "cluster not connected"                       | C1 to C9, C11                  |
| Approvals, backup, approve all, per-tool, Stop and New chat deny    | D1 to D5                       |
| API key and OAuth providers; custom endpoints and env keys          | E1 to E4                       |
| Proxy and CA, except Google, Bedrock and Codex WebSocket            | E7, E8                         |
| Explain on a warning event                                          | F1                             |
| Preferences; errors stay inside                                     | F2, A7                         |
| Light and dark theme                                                | A6                             |
| Disable during a run                                                | A4                             |
