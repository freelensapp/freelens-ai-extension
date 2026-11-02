// A unified line diff of two texts, for the dry-run preview of an approval
// card: the lines the two share at the start and the end are set aside, and
// the rest is compared by their longest common subsequence.

/** Lines of context around each change. */
const CONTEXT_LINES = 3;
/**
 * The most cells of the subsequence table: two very different large objects
 * are shown as every line removed and every line added instead.
 */
const MAX_TABLE_CELLS = 4_000_000;

interface DiffLine {
  type: " " | "-" | "+";
  line: string;
}

const linesOf = (text: string): string[] =>
  text === "" ? [] : (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");

const removed = (lines: readonly string[]): DiffLine[] => lines.map((line) => ({ type: "-", line }));
const added = (lines: readonly string[]): DiffLine[] => lines.map((line) => ({ type: "+", line }));
const kept = (lines: readonly string[]): DiffLine[] => lines.map((line) => ({ type: " ", line }));

// The lines of `before` and `after` that differ, removals before additions.
const middleDiff = (before: readonly string[], after: readonly string[]): DiffLine[] => {
  if (before.length * after.length > MAX_TABLE_CELLS) return [...removed(before), ...added(after)];
  const width = after.length + 1;
  // common[i * width + j]: the length of the longest common subsequence of before[i..] and after[j..].
  const common = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      common[i * width + j] =
        before[i] === after[j]
          ? common[(i + 1) * width + j + 1]! + 1
          : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      lines.push({ type: " ", line: before[i++]! });
      j++;
    } else if (common[(i + 1) * width + j]! >= common[i * width + j + 1]!) {
      lines.push({ type: "-", line: before[i++]! });
    } else {
      lines.push({ type: "+", line: after[j++]! });
    }
  }
  return [...lines, ...removed(before.slice(i)), ...added(after.slice(j))];
};

const diffLines = (before: readonly string[], after: readonly string[]): DiffLine[] => {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  return [
    ...kept(before.slice(0, start)),
    ...middleDiff(before.slice(start, endBefore), after.slice(start, endAfter)),
    ...kept(before.slice(endBefore)),
  ];
};

// `-<start>,<count>`: the first line of the range, or the line before an empty range.
const range = (linesBefore: number, count: number) => `${count === 0 ? linesBefore : linesBefore + 1},${count}`;

/**
 * The unified diff from `before` to `after`, with headers named by `labels`,
 * or an empty string when the texts have the same lines.
 */
export function unifiedDiff(before: string, after: string, labels: { before: string; after: string }): string {
  const lines = diffLines(linesOf(before), linesOf(after));
  const changes = lines.flatMap((line, index) => (line.type === " " ? [] : [index]));
  if (changes.length === 0) return "";

  // The ranges of lines each hunk shows, merged when their context touches.
  const hunks: { start: number; end: number }[] = [];
  for (const index of changes) {
    const start = Math.max(0, index - CONTEXT_LINES);
    const end = Math.min(lines.length, index + CONTEXT_LINES + 1);
    const last = hunks.at(-1);
    if (last && start <= last.end) last.end = end;
    else hunks.push({ start, end });
  }

  let text = `--- ${labels.before}\n+++ ${labels.after}\n`;
  for (const { start, end } of hunks) {
    const shown = lines.slice(start, end);
    const linesBefore = lines.slice(0, start).filter((line) => line.type !== "+").length;
    const linesAfter = lines.slice(0, start).filter((line) => line.type !== "-").length;
    const countBefore = shown.filter((line) => line.type !== "+").length;
    const countAfter = shown.filter((line) => line.type !== "-").length;
    text += `@@ -${range(linesBefore, countBefore)} +${range(linesAfter, countAfter)} @@\n`;
    text += shown.map(({ type, line }) => `${type}${line}\n`).join("");
  }
  return text;
}
