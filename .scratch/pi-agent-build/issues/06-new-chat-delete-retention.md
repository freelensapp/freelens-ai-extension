# 06: New chat, delete all chats and chat retention

**What to build:** the user manages their chats and storage stays bounded.
"New chat" starts a new session file for the cluster. "Delete all chats"
removes every session file of the current cluster. Main deletes session files
older than the retention preference ("Delete chats older than N days",
default 30, 0 keeps forever) on activation and on New chat, across every
cluster folder, never touching a cluster's active chat.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `new_session` starts a new JSONL file, the old file stays on disk, and
      the chat shows an empty transcript; a running run is aborted first.
- [ ] `delete_sessions` removes all session files of that cluster and starts
      a new empty chat.
- [ ] Retention prunes by each file's modified time from
      `SessionManager.list()`, in all cluster folders, including folders of
      removed clusters; the active chat of each cluster is kept.
- [ ] The retention preference exists with default 30; 0 disables pruning.
- [ ] Agent host tests with a fake clock and a temporary folder cover New
      chat, delete all, pruning with old and new files, 0 days and the active
      chat being kept.
- [ ] HITL: New chat and Delete all chats work from the chat UI.
