# Frames talk to the agent over Freelens IPC, not a local HTTP bridge

The pi agent runs in the main process, one session per cluster. The cluster
frames send it commands with `Renderer.Ipc.invoke`, and the main process
broadcasts envelopes (`{ clusterId, sessionId, seq, kind, payload }`) that each
frame filters by its own cluster. We kept this design for the Freelens v2 port.
We did not switch to the local HTTP/SSE bridge that the LangChain build of the
extension uses and that the extension template recommends for streams. A
broadcast reaches every frame of every window. It stays inside the app and on
the extension's own channel, and the snapshot plus `seq` already recover the
envelopes a frame missed. A bridge would add a server, a port, a token and
their lifecycle, and the chat gains nothing from them.

## Considered Options

- **Local HTTP/SSE bridge in the main process**: each frame gets a stream of its
  own, and closing the request cancels the run. It is what the LangChain v2
  build does. Rejected because the IPC protocol already works and the pi agent
  needs none of what the bridge adds.
