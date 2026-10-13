// Server-sent events as the bridge uses them: one `data:` line of JSON per
// event, which carries its own `type`. JSON has no raw line breaks, so an event
// never spans lines.

export const encodeSseEvent = (event: object): string => `data: ${JSON.stringify(event)}\n\n`;

const BLOCK_SEPARATOR = /\r?\n\r?\n/;

// Parses the `data:` fields of one SSE block; other fields and comments are
// ignored.
const parseSseBlock = (block: string): unknown => {
  const data = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  return data.length > 0 ? JSON.parse(data) : undefined;
};

/**
 * Reads the events of an SSE response body as they arrive. Ends when the body
 * ends; a trailing block without its blank line is still delivered. When the
 * consumer stops early, the body is cancelled, which closes the request.
 */
export async function* readSseEvents<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  try {
    while (!finished) {
      const { done, value } = await reader.read();
      finished = done;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      let match = BLOCK_SEPARATOR.exec(buffer);
      while (match) {
        const event = parseSseBlock(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (event !== undefined) {
          yield event as T;
        }
        match = BLOCK_SEPARATOR.exec(buffer);
      }
    }

    const event = parseSseBlock(buffer);
    if (event !== undefined) {
      yield event as T;
    }
  } finally {
    if (!finished) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}
