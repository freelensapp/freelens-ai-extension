import { RemoveMessage } from "@langchain/core/messages";
import { GraphState } from "../state/graph-state";

/* this is the size of the history to keep in the state.
 * it is used to limit the number of messages stored in the state.
 * when the number of messages exceeds this size, the oldest messages are removed.
 *
 * Example: if the history size is 5, and there are 10 messages in the state,
 * the last 5 messages will be kept and the first 5 messages will be removed.
 */
const HISTORY_SIZE = 5;

export function teardownNode(state: typeof GraphState.State) {
  console.log("Teardown Node - called with input: ", state);
  const messages = state.messages;
  if (messages.length > HISTORY_SIZE) {
    return { messages: messages.slice(0, -HISTORY_SIZE).map((m) => new RemoveMessage({ id: m.id })) };
  }
  return {};
}
