// Pure helpers to project a subset of fields out of a Kubernetes resource using
// a JSONPath-style field selector (the kubectl `-o jsonpath` subset). Kept free
// of host/MobX dependencies so they can be unit-tested directly (see
// field-filter.test.ts).
//
// Supported selector syntax (relative to a single resource object):
//   .metadata.name                         dot notation
//   .spec.containers[*].image              wildcard over array elements
//   .spec.containers[0].name               explicit array index
//   .metadata.labels['app.kubernetes.io/name']  bracketed quoted key (dots in key)
//   .status.*                              wildcard over object keys
//   .status.conditions[?(@.type=='Ready')] array elements matching a filter
//                                          (==, !=, <, <=, >, >=, or [?(@.key)] for presence)
// Optional kubectl-style wrapping braces ({ ... }) and a leading `$` are
// tolerated. The matched values are copied into a fresh object that preserves
// the nested structure of the source, so the model can tell which field is which.

/** A literal on the right side of a filter comparison. */
type FilterLiteral = string | number | boolean | null;

type FilterOperator = "==" | "!=" | "<" | "<=" | ">" | ">=";

interface FilterSegment {
  type: "filter";
  path: string[];
  operator?: FilterOperator;
  value?: FilterLiteral;
}

type Segment = { type: "key"; key: string } | { type: "index"; index: number } | { type: "wildcard" } | FilterSegment;

interface Match {
  path: (string | number)[];
  value: unknown;
}

/**
 * Parse a single JSONPath-style selector into a flat list of segments. Throws an
 * Error with a readable message when the selector is malformed so the caller can
 * surface it to the model.
 */
export function parseFieldPath(raw: string): Segment[] {
  let source = raw.trim();
  if (source.startsWith("{") && source.endsWith("}")) {
    source = source.slice(1, -1).trim();
  }
  if (source.startsWith("$")) {
    source = source.slice(1);
  }

  const segments: Segment[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === ".") {
      i++;
      i = readDotSegment(source, i, segments);
    } else if (char === "[") {
      i = readBracketSegment(source, i, segments, raw);
    } else {
      // A bare leading key without a leading dot (e.g. "metadata.name").
      i = readDotSegment(source, i, segments);
    }
  }

  if (segments.length === 0) {
    throw new Error(`Invalid field selector "${raw}": it does not reference any field.`);
  }
  return segments;
}

/**
 * Read a dot-style key (or `*` wildcard) starting at `i`, pushing the resulting
 * segment, and return the new cursor position.
 */
function readDotSegment(source: string, i: number, segments: Segment[]): number {
  if (source[i] === "*") {
    segments.push({ type: "wildcard" });
    return i + 1;
  }
  let key = "";
  while (i < source.length && source[i] !== "." && source[i] !== "[") {
    key += source[i];
    i++;
  }
  if (key === "*") {
    segments.push({ type: "wildcard" });
  } else if (key.length > 0) {
    segments.push({ type: "key", key });
  }
  return i;
}

/** Index of the "]" that closes the "[" at `open`, skipping quoted text and nested brackets. */
function findClosingBracket(source: string, open: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let k = open; k < source.length; k++) {
    const char = source[k];
    if (quote) {
      if (char === "\\") {
        k++;
      } else if (char === quote) {
        quote = undefined;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "[") {
      depth++;
    } else if (char === "]" && --depth === 0) {
      return k;
    }
  }
  return -1;
}

function parseFilterLiteral(text: string, raw: string): FilterLiteral {
  if (text.length >= 2 && (text[0] === "'" || text[0] === '"') && text.at(-1) === text[0]) {
    return text.slice(1, -1);
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  const number = Number(text);
  if (text !== "" && Number.isFinite(number)) return number;
  throw new Error(`Invalid field selector "${raw}": invalid filter value "${text}".`);
}

/** Parse `?(@.path OP literal)` or `?(@.path)`, the filter expressions of kubectl's JSONPath. */
function parseFilter(inner: string, raw: string): FilterSegment {
  let expression = inner.slice(1).trim();
  if (expression.startsWith("(") && expression.endsWith(")")) {
    expression = expression.slice(1, -1).trim();
  }
  const match = /^@((?:\.[^.\s=!<>[\]*]+|\[(?:'[^']*'|"[^"]*")\])*)\s*(?:(==|!=|<=|>=|<|>)\s*(.+))?$/s.exec(expression);
  if (!match) {
    throw new Error(`Invalid field selector "${raw}": unsupported filter "${inner}".`);
  }
  const [, pathText, operator, valueText] = match;
  const path: string[] = [];
  if (pathText) {
    for (const segment of parseFieldPath(pathText)) {
      if (segment.type !== "key") {
        throw new Error(`Invalid field selector "${raw}": unsupported filter path "${pathText}".`);
      }
      path.push(segment.key);
    }
  }
  if (!operator) {
    return { type: "filter", path };
  }
  return {
    type: "filter",
    path,
    operator: operator as FilterOperator,
    value: parseFilterLiteral(valueText.trim(), raw),
  };
}

function filterMatches(element: unknown, segment: FilterSegment): boolean {
  let value: unknown = element;
  for (const key of segment.path) {
    if (!isPlainObject(value) || !Object.hasOwn(value, key)) {
      value = undefined;
      break;
    }
    value = value[key];
  }
  const expected = segment.value;
  switch (segment.operator) {
    case undefined:
      return value !== undefined && value !== null;
    case "==":
      return value === expected;
    case "!=":
      return value !== expected;
  }
  const comparable =
    (typeof value === "number" && typeof expected === "number") ||
    (typeof value === "string" && typeof expected === "string");
  if (!comparable) {
    return false;
  }
  const [left, right] = [value, expected] as [number | string, number | string];
  switch (segment.operator) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
  }
}

/**
 * Read a bracket-style segment (`[*]`, `[0]`, `['key']`, `["key"]`, `[key]` or
 * a `[?(...)]` filter) starting at the opening `[`, pushing the resulting
 * segment, and return the new cursor position.
 */
function readBracketSegment(source: string, i: number, segments: Segment[], raw: string): number {
  const end = findClosingBracket(source, i);
  if (end === -1) {
    throw new Error(`Invalid field selector "${raw}": unterminated "[".`);
  }
  const inner = source.slice(i + 1, end).trim();
  if (inner === "*") {
    segments.push({ type: "wildcard" });
  } else if (inner.startsWith("?")) {
    segments.push(parseFilter(inner, raw));
  } else if ((inner.startsWith("'") && inner.endsWith("'")) || (inner.startsWith('"') && inner.endsWith('"'))) {
    segments.push({ type: "key", key: inner.slice(1, -1) });
  } else if (/^-?\d+$/.test(inner)) {
    segments.push({ type: "index", index: Number(inner) });
  } else if (inner.length > 0) {
    segments.push({ type: "key", key: inner });
  } else {
    throw new Error(`Invalid field selector "${raw}": empty "[]".`);
  }
  return end + 1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve the concrete matches (path + value) of a parsed selector against a
 * source object, expanding wildcards against the actual data.
 */
function resolveMatches(source: unknown, segments: Segment[]): Match[] {
  let frontier: Match[] = [{ path: [], value: source }];
  for (const segment of segments) {
    const next: Match[] = [];
    for (const node of frontier) {
      const value = node.value;
      if (value == null) {
        continue;
      }
      if (segment.type === "key") {
        if (isPlainObject(value) && Object.hasOwn(value, segment.key)) {
          next.push({ path: [...node.path, segment.key], value: value[segment.key] });
        }
      } else if (segment.type === "index") {
        if (Array.isArray(value)) {
          const index = segment.index < 0 ? value.length + segment.index : segment.index;
          if (index >= 0 && index < value.length) {
            next.push({ path: [...node.path, index], value: value[index] });
          }
        }
      } else if (segment.type === "filter") {
        if (Array.isArray(value)) {
          value.forEach((element, index) => {
            if (filterMatches(element, segment)) {
              next.push({ path: [...node.path, index], value: element });
            }
          });
        }
      } else {
        if (Array.isArray(value)) {
          value.forEach((element, index) => next.push({ path: [...node.path, index], value: element }));
        } else if (isPlainObject(value)) {
          for (const key of Object.keys(value)) {
            next.push({ path: [...node.path, key], value: value[key] });
          }
        }
      }
    }
    frontier = next;
  }
  return frontier;
}

/**
 * Set `value` at `path` inside `target`, creating intermediate objects/arrays as
 * needed. A numeric path segment creates an array, a string segment an object.
 */
function setPath(target: Record<string, unknown>, path: (string | number)[], value: unknown): void {
  let cursor: Record<string, unknown> | unknown[] = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const nextKey = path[i + 1];
    const container = cursor as Record<string | number, unknown>;
    if (container[key] == null) {
      container[key] = typeof nextKey === "number" ? [] : {};
    }
    cursor = container[key] as Record<string, unknown> | unknown[];
  }
  (cursor as Record<string | number, unknown>)[path[path.length - 1]] = value;
}

export type FieldSelector = (object: Record<string, unknown>) => Record<string, unknown>;

/**
 * Compile a list of JSONPath-style selectors into a reusable function that
 * projects an object down to only the matched fields, preserving their nested
 * structure. Returns `null` when no selectors are provided (meaning: keep the
 * full object). Throws on a malformed selector so the caller can report it.
 */
export function buildFieldSelector(fields?: string[]): FieldSelector | null {
  if (!fields || fields.length === 0) {
    return null;
  }
  const parsed = fields.map((field) => parseFieldPath(field));
  return (object) => {
    const result: Record<string, unknown> = {};
    for (const segments of parsed) {
      for (const match of resolveMatches(object, segments)) {
        if (match.path.length > 0) {
          setPath(result, match.path, match.value);
        }
      }
    }
    return result;
  };
}
