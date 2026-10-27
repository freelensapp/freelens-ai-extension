import type { Renderer } from "@freelensapp/extensions";

/**
 * A renderer client's connection to main: one `Renderer.Ipc` of the extension,
 * listening on the client's envelope channel. The extension connects it on
 * activation and disconnects it on deactivation. The host drops the instance
 * and its listeners on Disable, and Enable activates the extension again in
 * the module already loaded, so a connection kept past a deactivation would
 * receive nothing.
 */
export class IpcConnection<Envelope> {
  private ipc: Renderer.Ipc | undefined;
  private stopListening: (() => void) | undefined;

  constructor(
    private readonly createIpc: (extension: Renderer.LensExtension) => Renderer.Ipc,
    private readonly envelopeChannel: string,
  ) {}

  get connected(): boolean {
    return this.ipc !== undefined;
  }

  /** Calls `onEnvelope` with every envelope main broadcasts; does nothing while connected. */
  connect(extension: Renderer.LensExtension, onEnvelope: (envelope: Envelope) => void): void {
    if (this.ipc) return;
    const ipc = this.createIpc(extension);
    this.stopListening = ipc.listen(this.envelopeChannel, (_event, envelope: Envelope) => onEnvelope(envelope));
    this.ipc = ipc;
  }

  disconnect(): void {
    this.stopListening?.();
    this.stopListening = undefined;
    this.ipc = undefined;
  }

  /** Sends to main's handler of `channel`; rejects when not connected or when main fails. */
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!this.ipc) throw new Error("Not connected to the main process.");
    return this.ipc.invoke(channel, ...args);
  }
}
