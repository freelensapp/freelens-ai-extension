# Existing saved chats

Type: grilling
Status: resolved
Blocked by:

## Question

When users upgrade, do we convert LangGraph checkpoints into pi sessions, or
make a clean break?

## Answer

Clean break (option b). Existing chats do not need to be preserved; no
LangChain-to-pi message mapper is written. Resolved by leo-capvano in PR #290,
grilling round 1. Whether the old store files are deleted on upgrade or just
ignored is left to [Session storage](11-session-storage.md).
