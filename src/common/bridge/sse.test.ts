import { describe, expect, it } from "vitest";
import { encodeSseEvent, readSseEvents } from "./sse";

// A body that delivers the given strings as separate chunks.
const bodyOf = (chunks: string[]) => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
};

const readAll = async (body: ReadableStream<Uint8Array>) => {
  const events: unknown[] = [];
  for await (const event of readSseEvents(body)) {
    events.push(event);
  }
  return events;
};

describe("encodeSseEvent", () => {
  it("writes one data line of JSON and a blank line", () => {
    expect(encodeSseEvent({ type: "text", text: "a\nb" })).toBe('data: {"type":"text","text":"a\\nb"}\n\n');
  });
});

describe("readSseEvents", () => {
  it("reads back what encodeSseEvent writes", async () => {
    const events = [{ type: "text", text: "Hello" }, { type: "usage", tokenUsage: { input: 1 } }, { type: "done" }];

    expect(await readAll(bodyOf(events.map(encodeSseEvent)))).toEqual(events);
  });

  it("joins an event split across chunks, even inside a multi-byte character", async () => {
    const encoded = new TextEncoder().encode(encodeSseEvent({ type: "text", text: "zażółć" }));
    const cut = encoded.indexOf(0xc5) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, cut));
        controller.enqueue(encoded.slice(cut));
        controller.close();
      },
    });

    expect(await readAll(body)).toEqual([{ type: "text", text: "zażółć" }]);
  });

  it("accepts CRLF line breaks, skips comments and delivers a trailing block", async () => {
    expect(await readAll(bodyOf([': keep-alive\r\n\r\ndata: {"a":1}\r\n\r\n', 'data: {"b":2}']))).toEqual([
      { a: 1 },
      { b: 2 },
    ]);
  });

  it("cancels the body when the consumer stops early", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(encodeSseEvent({ n: 1 }) + encodeSseEvent({ n: 2 })));
      },
      cancel() {
        cancelled = true;
      },
    });

    for await (const event of readSseEvents(body)) {
      expect(event).toEqual({ n: 1 });
      break;
    }

    expect(cancelled).toBe(true);
  });
});
