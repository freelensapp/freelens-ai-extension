# Freelens AI

An AI chat for every cluster open in Freelens: an agent that reads the cluster
and, with the user's approval, changes it.

## Language

**CLI invocation**:
One run of kubectl or helm by the agent against the chat's cluster, with its arguments, the manifest it sends (if any), its output and its exit code.
_Avoid_: kubectl command, shell command, kubectl call

**Floor**:
The checks every CLI invocation must pass whatever the user configured: it stays on the chat's cluster, never reveals credentials, never touches the user's disk or runs local code, and always ends on its own.
_Avoid_: hard denylist, blocklist

**Policy level**:
What happens to a CLI invocation that passes the floor: Allow (runs), Ask (waits for approval, which Approve all in this chat covers), Always ask (waits for approval even then), or Deny (rejected).
_Avoid_: permission, approval mode

**Canonical form**:
One target of a CLI invocation written as `<program> <verb> <resource> <name> -n <namespace>`, however the arguments were spelled; an invocation has one per resource, name or manifest object it targets, and policy rules match them.
_Avoid_: normalized command

**Policy rule**:
A glob over the canonical form with the policy level it gives, such as `kubectl delete namespaces *` to Always ask.
_Avoid_: allowlist entry, permission

**Policy profile**:
A named set of policy rules with a fallback level, such as Read only, Standard or Permissive, that is assigned to clusters; every cluster has exactly one. The order of its rules does not matter.
_Avoid_: preset, mode, role

**Fallback level**:
The policy level a profile gives a CLI invocation that none of its rules matches. When several rules match, the most specific one decides, and on a tie the most restrictive.

**Shipped profile**:
A policy profile that comes with Freelens AI and cannot be changed; the user duplicates it to make a variant.

**User profile**:
A policy profile the user created or duplicated, every rule of which the user can change.

**Default profile**:
The policy profile of every cluster without an explicit assignment.

**Approve all in this chat**:
The user's answer on an approval that lets every later Ask invocation of the same chat run without asking, until a new chat or a restart.
_Avoid_: auto-approve, bypass approvals

**Command**:
A request from a cluster frame to the agent in the main process, such as a prompt, a stop or an approval answer.
_Avoid_: using it for a CLI invocation
