import { describe, expect, it } from "vitest";
import { splitCommandLine } from "./split-command-line";

describe("splitCommandLine", () => {
  it("splits a command line at runs of whitespace", () => {
    expect(splitCommandLine("  kubectl  get\tpods -n web ")).toEqual({
      kind: "words",
      words: ["kubectl", "get", "pods", "-n", "web"],
    });
  });

  it("keeps the text of single quotes as it is, a backslash included", () => {
    expect(splitCommandLine("kubectl get pods -o 'jsonpath={.items[*]} \\n'")).toEqual({
      kind: "words",
      words: ["kubectl", "get", "pods", "-o", "jsonpath={.items[*]} \\n"],
    });
  });

  it("lets a backslash in double quotes escape a double quote, a backslash, a dollar sign or a backquote only", () => {
    expect(splitCommandLine('kubectl annotate pods web note="say \\"hi\\" \\\\ \\$ \\` \\n"')).toEqual({
      kind: "words",
      words: ["kubectl", "annotate", "pods", "web", 'note=say "hi" \\ $ ` \\n'],
    });
  });

  it("lets a backslash outside quotes keep the next character, a space included", () => {
    expect(splitCommandLine("kubectl label pods web note=a\\ b")).toEqual({
      kind: "words",
      words: ["kubectl", "label", "pods", "web", "note=a b"],
    });
  });

  it("joins quoted and unquoted text without space between into one word, and keeps an empty quoted word", () => {
    expect(splitCommandLine(`kubectl label pods web a="b c"'d' "" ''`)).toEqual({
      kind: "words",
      words: ["kubectl", "label", "pods", "web", "a=b cd", "", ""],
    });
  });

  it("reads back a single quote written as a shell writes it, '\\''", () => {
    expect(splitCommandLine("kubectl annotate pods web 'note=it'\\''s'")).toEqual({
      kind: "words",
      words: ["kubectl", "annotate", "pods", "web", "note=it's"],
    });
  });

  it("expands nothing: variables, globs, a tilde and command substitutions stay as typed", () => {
    expect(splitCommandLine("kubectl get pods $NS ~ * $(whoami) `id` ; rm")).toEqual({
      kind: "words",
      words: ["kubectl", "get", "pods", "$NS", "~", "*", "$(whoami)", "`id`", ";", "rm"],
    });
  });

  it("says which quote is not closed", () => {
    expect(splitCommandLine("kubectl get pods -l 'app=web")).toEqual({
      kind: "error",
      error: "The single quote is not closed.",
    });
    expect(splitCommandLine('kubectl get pods -l "app=web')).toEqual({
      kind: "error",
      error: "The double quote is not closed.",
    });
  });

  it("rejects a backslash at the end of the line", () => {
    expect(splitCommandLine("kubectl get pods \\")).toEqual({
      kind: "error",
      error: "The backslash at the end escapes nothing.",
    });
  });

  it("returns no words for an empty line", () => {
    expect(splitCommandLine("   ")).toEqual({ kind: "words", words: [] });
  });
});
