/**
 * Pure serialization helpers for a `MemorySaver`'s in-memory state so it can be
 * persisted as a JSON string in an `ExtensionStore` and restored after an
 * application restart.
 *
 * `MemorySaver` keeps its checkpoints in two nested plain objects (`storage`
 * and `writes`) whose leaf values are `Uint8Array`s produced by the saver's
 * serde. `JSON.stringify` cannot round-trip a `Uint8Array` (it turns into a
 * `{ "0": .., "1": .. }` object), so the binary leaves are tagged and base64
 * encoded here and decoded back on load. The intermediate container objects are
 * plain JSON and survive `JSON.stringify`/`JSON.parse` unchanged.
 *
 * No host, MobX, or LangGraph runtime dependency, so it is unit-tested directly.
 */

export interface SaverState {
  storage: unknown;
  writes: unknown;
}

// Marker key identifying an encoded `Uint8Array` leaf in the serialized JSON.
const UINT8_TAG = "$u8";
// Marker for an explicit `undefined`. `MemorySaver` stores `undefined` as the
// parent-checkpoint-id of every thread's root checkpoint and later branches on
// `parentCheckpointId !== undefined`; plain JSON would turn that `undefined`
// into `null` (which is `!== undefined`), fabricating a parent. Tagging keeps
// the distinction across a round-trip.
const UNDEFINED_TAG = "$undef";

const uint8ToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  // Chunk to avoid blowing the argument limit of `String.fromCharCode` on
  // large checkpoints.
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const base64ToUint8 = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const isTagged = (value: unknown, tag: string): boolean =>
  typeof value === "object" && value !== null && tag in (value as Record<string, unknown>);

/**
 * Serialize a saver's `storage`/`writes` into a JSON string. Returns output that
 * {@link deserializeSaverState} can read back, with `Uint8Array` leaves and
 * explicit `undefined` values preserved.
 */
export const serializeSaverState = (state: SaverState): string =>
  JSON.stringify(state, (_key, value) => {
    if (value instanceof Uint8Array) {
      return { [UINT8_TAG]: uint8ToBase64(value) };
    }
    if (value === undefined) {
      return { [UNDEFINED_TAG]: true };
    }
    return value;
  });

/**
 * Parse a blob produced by {@link serializeSaverState}. A missing, empty, or
 * corrupt blob yields empty containers rather than throwing, so a bad persisted
 * value can never crash agent initialization.
 */
export const deserializeSaverState = (blob: string | null | undefined): SaverState => {
  if (!blob) {
    return { storage: {}, writes: {} };
  }

  try {
    const parsed = JSON.parse(blob, (_key, value) => {
      if (isTagged(value, UINT8_TAG)) {
        return base64ToUint8((value as Record<string, string>)[UINT8_TAG]);
      }
      if (isTagged(value, UNDEFINED_TAG)) {
        return undefined;
      }
      return value;
    });
    return {
      storage: parsed?.storage ?? {},
      writes: parsed?.writes ?? {},
    };
  } catch {
    return { storage: {}, writes: {} };
  }
};
