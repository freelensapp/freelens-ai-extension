/** The words of a command line, or why it cannot be split. */
export type CommandLineSplit = { kind: "words"; words: string[] } | { kind: "error"; error: string };

/** The characters a backslash escapes in double quotes; before any other, it stays. */
const ESCAPED_IN_DOUBLE_QUOTES: ReadonlySet<string> = new Set(['"', "\\", "$", "`"]);

/**
 * Splits a command line into the words a POSIX shell would pass to the
 * program, by its quoting rules alone: single quotes keep their text as it
 * is, a backslash in double quotes escapes a double quote, a backslash, a
 * dollar sign or a backquote, and one outside quotes keeps the next
 * character. Nothing is expanded, so a
 * variable, a glob, a tilde or a command substitution stays as typed, and an
 * operator such as `;` or `|` is a word like any other.
 */
export function splitCommandLine(line: string): CommandLineSplit {
  const words: string[] = [];
  // The word being read; undefined between words, so that `""` is a word.
  let word: string | undefined;
  let index = 0;
  while (index < line.length) {
    const char = line[index] ?? "";
    if (/\s/.test(char)) {
      if (word !== undefined) words.push(word);
      word = undefined;
      index++;
    } else if (char === "'") {
      const end = line.indexOf("'", index + 1);
      if (end === -1) return { kind: "error", error: "The single quote is not closed." };
      word = (word ?? "") + line.slice(index + 1, end);
      index = end + 1;
    } else if (char === '"') {
      let text = "";
      index++;
      while (index < line.length && line[index] !== '"') {
        const next = line[index + 1];
        if (line[index] === "\\" && next !== undefined && ESCAPED_IN_DOUBLE_QUOTES.has(next)) {
          text += next;
          index += 2;
        } else {
          text += line[index];
          index++;
        }
      }
      if (index >= line.length) return { kind: "error", error: "The double quote is not closed." };
      word = (word ?? "") + text;
      index++;
    } else if (char === "\\") {
      const next = line[index + 1];
      if (next === undefined) return { kind: "error", error: "The backslash at the end escapes nothing." };
      word = (word ?? "") + next;
      index += 2;
    } else {
      word = (word ?? "") + char;
      index++;
    }
  }
  if (word !== undefined) words.push(word);
  return { kind: "words", words };
}
