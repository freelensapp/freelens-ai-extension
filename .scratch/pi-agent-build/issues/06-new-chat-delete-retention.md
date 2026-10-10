# 06: New chat, delete all chats and chat retention

**What to build:** the user manages their chats and storage stays bounded.
"New chat" starts a new session file for the cluster. "Delete all chats"
removes every session file of the current cluster. Main deletes session files
older than the retention preference ("Delete chats older than N days",
default 30, 0 keeps forever) on activation and on New chat, across every
cluster folder, never touching a cluster's active chat.

**Blocked by:** 02

**Status:** resolved (HITL check pending)

- [x] `new_session` starts a new JSONL file, the old file stays on disk, and
      the chat shows an empty transcript; a running run is aborted first.
- [x] `delete_sessions` removes all session files of that cluster and starts
      a new empty chat.
- [x] Retention prunes by each file's modified time from
      `SessionManager.list()`, in all cluster folders, including folders of
      removed clusters; the active chat of each cluster is kept.
- [x] The retention preference exists with default 30; 0 disables pruning.
- [x] Agent host tests with a fake clock and a temporary folder cover New
      chat, delete all, pruning with old and new files, 0 days and the active
      chat being kept.
- [ ] HITL: New chat and Delete all chats work from the chat UI.

## Answer

Built in `src/main/agent/agent-host.ts`, with the chat side in
`agent-client.ts` (`resetAgentChat`) and the buttons in `text-input.tsx`.

- **New chat** (`new_session`) waits for a prompt that pi has not started yet,
  stops the run (denying approvals and failing tool calls, as Stop does),
  disposes the session and answers with the empty chat's snapshot. The frame
  replaces its transcript with it; the snapshot's `seq` makes it ignore late
  envelopes of the old chat. Prompts sent meanwhile wait and go to the new
  chat. The old file stays on disk.
- **A restart right after New chat** would reopen the old file, because pi's
  `continueRecent` takes the newest file and the new chat has none until its
  first message. New chat therefore leaves a `.new-chat` marker in the
  cluster folder; while it exists the next start opens a new session, and it
  is removed once pi saves the first message.
- **Delete all chats** (`delete_sessions`) does the same and then removes the
  cluster's whole folder. The UI asks for confirmation first.
- **Retention** (`pruneSessions`) uses `SessionManager.listAll(<folder>)`,
  whose `modified` is the time of the last message. The active chat of a
  folder is the open session, or else the newest file, unless the folder has
  the New chat marker or belongs to a cluster Freelens no longer lists
  (`Main.Catalog.getAllClusters()`). An emptied folder of a cluster that is
  not open is removed.
- **When it runs:** on activation and on New chat. On activation the
  cluster list is not used, because the catalog is still loading: every
  folder keeps its newest chat, and removed clusters lose theirs on the next
  New chat.
- **Preference:** `chatRetentionDays` in `PreferencesStore`, default
  `DEFAULT_CHAT_RETENTION_DAYS` (30), under "Chats" on the settings page.
  Anything but a whole number of 0 or more falls back to 30.
- The old "Clear chat" button is now **New chat**; it still clears the
  LangChain state AI Explain uses, until ticket 13.

Known gaps:

- The race of a prompt still starting during New chat could not be
  reproduced with pi's faux provider. The fix follows pi's source (its abort
  does nothing before `_runAgentPrompt`), and the regression test checks that
  no closed session calls the model.
- AI Explain answers are not in the pi session, so New chat clears them
  together with the rest of the transcript, as before.
