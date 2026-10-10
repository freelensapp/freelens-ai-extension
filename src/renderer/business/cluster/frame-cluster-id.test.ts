import { describe, expect, it } from "vitest";
import { getClusterIdFromFrameHost } from "./frame-cluster-id";

describe("getClusterIdFromFrameHost", () => {
  it("reads the cluster id of a cluster frame", () => {
    expect(getClusterIdFromFrameHost("3f2a9c.renderer.freelens.app")).toBe("3f2a9c");
    expect(getClusterIdFromFrameHost("3f2a9c.localhost:45345")).toBe("3f2a9c");
  });

  it("returns undefined for the root window", () => {
    expect(getClusterIdFromFrameHost("renderer.freelens.app")).toBeUndefined();
    expect(getClusterIdFromFrameHost("localhost:45345")).toBeUndefined();
    expect(getClusterIdFromFrameHost("")).toBeUndefined();
  });
});
