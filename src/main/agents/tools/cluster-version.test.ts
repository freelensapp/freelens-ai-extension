import { describe, expect, it } from "vitest";
import { summarizeClusterVersion } from "./cluster-version";

describe("summarizeClusterVersion", () => {
  it("uses gitVersion as the human-readable version and keeps the relevant details", () => {
    expect(
      summarizeClusterVersion({
        major: "1",
        minor: "29",
        gitVersion: "v1.29.2",
        gitCommit: "abc1234",
        gitTreeState: "clean",
        buildDate: "2024-02-14T10:40:24Z",
        goVersion: "go1.21.7",
        compiler: "gc",
        platform: "linux/amd64",
      }),
    ).toEqual({
      version: "v1.29.2",
      major: "1",
      minor: "29",
      gitCommit: "abc1234",
      buildDate: "2024-02-14T10:40:24Z",
      goVersion: "go1.21.7",
      platform: "linux/amd64",
    });
  });

  it("falls back to <major>.<minor> when gitVersion is missing", () => {
    expect(summarizeClusterVersion({ major: "1", minor: "30+" })).toEqual({
      version: "1.30+",
      major: "1",
      minor: "30+",
      gitCommit: undefined,
      buildDate: undefined,
      goVersion: undefined,
      platform: undefined,
    });
  });

  it('falls back to "unknown" when neither gitVersion nor major/minor are present', () => {
    expect(summarizeClusterVersion({})).toEqual({
      version: "unknown",
      major: undefined,
      minor: undefined,
      gitCommit: undefined,
      buildDate: undefined,
      goVersion: undefined,
      platform: undefined,
    });
  });

  it("treats blank strings as missing and trims surrounding whitespace", () => {
    expect(summarizeClusterVersion({ major: "1", minor: "  ", gitVersion: "  v1.28.0  " })).toEqual({
      version: "v1.28.0",
      major: "1",
      minor: undefined,
      gitCommit: undefined,
      buildDate: undefined,
      goVersion: undefined,
      platform: undefined,
    });
  });
});
