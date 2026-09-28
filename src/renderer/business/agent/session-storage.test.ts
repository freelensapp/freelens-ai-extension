import { describe, expect, it } from "vitest";
import { belongsToClusterSession, type KeyValueBackend, KeyValueSessionStorage, sessionIdFor } from "./session-storage";

const createBackend = (): KeyValueBackend & { entries: Map<string, string> } => {
  const entries = new Map<string, string>();
  return {
    entries,
    getEntry: (key) => entries.get(key),
    setEntry: (key, value) => void entries.set(key, value),
    deleteEntry: (key) => void entries.delete(key),
    entryKeys: () => [...entries.keys()],
  };
};

const bytes = (value: string) => new TextEncoder().encode(value);

describe("sessionIdFor", () => {
  it("qualifies the conversation with the cluster id", () => {
    expect(sessionIdFor("cluster-a", "conv-1")).toBe("cluster-a__conv-1");
  });

  it("maps characters the SDK rejects to hyphens and lowercases", () => {
    expect(sessionIdFor("My.Cluster:1", "ABC/def")).toBe("my-cluster-1__abc-def");
  });

  it("keeps different clusters in distinct sessions", () => {
    expect(sessionIdFor("cluster-a", "conv-1")).not.toBe(sessionIdFor("cluster-b", "conv-1"));
  });
});

describe("belongsToClusterSession", () => {
  it("matches keys of the same cluster's sessions", () => {
    expect(belongsToClusterSession(`session/${sessionIdFor("cluster-a", "c")}/scopes/agent/a`, "cluster-a")).toBe(true);
    expect(belongsToClusterSession(`${sessionIdFor("cluster-a", "c")}/scopes/agent/a`, "cluster-a")).toBe(true);
  });

  it("does not match another cluster's keys", () => {
    expect(belongsToClusterSession(`session/${sessionIdFor("cluster-a", "c")}/x`, "cluster-b")).toBe(false);
  });

  it("does not match on a cluster id that is only a prefix of another", () => {
    expect(belongsToClusterSession(`session/${sessionIdFor("cluster-a-extra", "c")}/x`, "cluster-a")).toBe(false);
  });
});

describe("KeyValueSessionStorage", () => {
  it("round-trips UTF-8 data as text", async () => {
    const backend = createBackend();
    const storage = new KeyValueSessionStorage(backend);
    await storage.write("a/b.json", bytes('{"text":"ciao è"}'));
    expect(backend.entries.get("a/b.json")).toBe('{"text":"ciao è"}');
    expect(new TextDecoder().decode((await storage.read("a/b.json")) as Uint8Array)).toBe('{"text":"ciao è"}');
  });

  it("returns null for a missing key", async () => {
    expect(await new KeyValueSessionStorage(createBackend()).read("missing")).toBeNull();
  });

  it("normalizes slashes in keys", async () => {
    const backend = createBackend();
    const storage = new KeyValueSessionStorage(backend);
    await storage.write("/a//b/", bytes("x"));
    expect([...backend.entries.keys()]).toEqual(["a/b"]);
    expect(await storage.read("a/b")).not.toBeNull();
  });

  it("deletes keys, ignoring missing ones", async () => {
    const backend = createBackend();
    const storage = new KeyValueSessionStorage(backend);
    await storage.write("a", bytes("x"));
    await storage.delete("a");
    await storage.delete("a");
    expect(backend.entries.size).toBe(0);
  });

  it("lists keys by prefix, sorted", async () => {
    const storage = new KeyValueSessionStorage(createBackend());
    await storage.write("s/2", bytes("x"));
    await storage.write("s/1", bytes("x"));
    await storage.write("t/1", bytes("x"));
    expect(await storage.list("s/")).toEqual(["s/1", "s/2"]);
    expect(await storage.list("")).toEqual(["s/1", "s/2", "t/1"]);
  });
});
