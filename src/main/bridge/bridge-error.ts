import type { BridgeError, BridgeErrorCode } from "../../common/bridge/protocol";

/** An error whose `code` the bridge sends to the renderer with its message. */
export class BridgeRequestError extends Error {
  constructor(
    message: string,
    readonly code: BridgeErrorCode,
  ) {
    super(message);
    this.name = "BridgeRequestError";
  }
}

export const toBridgeError = (error: unknown): BridgeError => {
  if (error instanceof BridgeRequestError) {
    return { message: error.message, code: error.code };
  }
  return { message: error instanceof Error ? error.message : String(error) };
};
