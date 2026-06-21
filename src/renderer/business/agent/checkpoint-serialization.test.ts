import { describe, expect, it } from "vitest";
import { deserializeSaverState, serializeSaverState } from "./checkpoint-serialization";

// Mirrors the nested shape a `MemorySaver` keeps: plain-object containers with
// `Uint8Array` leaves produced by its serde.
const sampleState = () => ({
  storage: {
    "thread-1": {
      "": {
        "checkpoint-a": [new Uint8Array([123, 34, 118, 34, 58, 52, 125]), new Uint8Array([1, 2, 3]), undefined],
      },
    },
  },
  writes: {
    '["thread-1","","checkpoint-a"]': {
      "task-1,0": ["task-1", "messages", new Uint8Array([255, 0, 128])],
    },
  },
});

describe("checkpoint-serialization", () => {
  it("round-trips storage and writes including Uint8Array leaves", () => {
    const state = sampleState();
    const blob = serializeSaverState(state);
    const restored = deserializeSaverState(blob);

    expect(restored).toEqual(state);
  });

  it("restores Uint8Array leaves as actual Uint8Array instances", () => {
    const blob = serializeSaverState(sampleState());
    const restored = deserializeSaverState(blob) as ReturnType<typeof sampleState>;

    const leaf = restored.storage["thread-1"][""]["checkpoint-a"][0];
    expect(leaf).toBeInstanceOf(Uint8Array);
    expect(Array.from(leaf as Uint8Array)).toEqual([123, 34, 118, 34, 58, 52, 125]);
  });

  it("preserves binary (non-UTF8) byte values through base64 encoding", () => {
    const state = { storage: { t: new Uint8Array([0, 255, 254, 1, 200]) }, writes: {} };
    const restored = deserializeSaverState(serializeSaverState(state)) as { storage: { t: Uint8Array } };

    expect(Array.from(restored.storage.t)).toEqual([0, 255, 254, 1, 200]);
  });

  it("returns empty containers for a missing blob", () => {
    expect(deserializeSaverState(null)).toEqual({ storage: {}, writes: {} });
    expect(deserializeSaverState(undefined)).toEqual({ storage: {}, writes: {} });
    expect(deserializeSaverState("")).toEqual({ storage: {}, writes: {} });
  });

  it("returns empty containers for a corrupt blob instead of throwing", () => {
    expect(deserializeSaverState("{not valid json")).toEqual({ storage: {}, writes: {} });
  });

  it("defaults missing storage/writes keys to empty objects", () => {
    expect(deserializeSaverState(JSON.stringify({}))).toEqual({ storage: {}, writes: {} });
  });
});
