# 13: Manual test cases for Freelens v2

**What to build:** a document the maintainer follows by hand in Freelens v2 to
check the port. Each case has its preconditions, numbered steps and the
expected result, and a place to mark pass or fail.

The cases cover:

- discovery and loading in both processes, with no errors in either log;
- the install from the extension's directory and the development reload: a
  rebuild reloads the extension without a restart and leaves one agent host
  and no duplicate messages;
- disabling the extension during a run;
- UI updates driven by mobx (streaming, approvals, preferences taking effect
  without reopening the chat);
- every user story of the spec, including Stop during a cluster request, a
  disconnected cluster, a frame reload during a run and during a pending
  approval, the backup on the approval card, deleting a pod with its
  finalizers, pod logs of a running container, the HTTPS proxy and CA
  settings, both themes and the error boundaries;
- the pending manual checks of the fourteen pi agent build tickets, each
  folded into a case and referenced by ticket;
- two clusters open at once.

The cases name the test environment they assume (a kind cluster, a provider
login) and how to create the objects they need.

**Blocked by:** 10 (write tools in the main process), 11 (model requests
through the Freelens HTTP client).

**Status:** ready-for-agent

- [ ] Every user story of the spec maps to at least one case, and the document
      lists the mapping.
- [ ] Every pending manual check of the pi agent build tickets maps to a case.
- [ ] Each case has preconditions, steps and an expected result a tester can
      check without reading the code.
- [ ] Trunk passes on the document; one commit, pushed.
