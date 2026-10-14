/**
 * Redaction of credentials carried by the objects the extension logs.
 *
 * Every value logged through the logger service is passed through here first,
 * so an object that happens to carry an API key never prints it in cleartext
 * into the DevTools console.
 */

export const REDACTED = "<redacted>";

// Keys whose value is a credential wherever it appears.
const SECRET_KEYS = new Set(["apiKey", "api_key", "modelApiKey"]);

// Deep enough for the shapes actually logged, shallow enough to bound the walk
// on a large or self-referencing object.
const MAX_DEPTH = 6;

// Only plain objects and arrays are walked: a class instance (an Error) is left
// untouched so the log keeps showing it as-is.
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};

const redactValue = (value: unknown, depth: number): unknown => {
  if (depth >= MAX_DEPTH) {
    return value;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const redacted = redactValue(item, depth + 1);
      changed = changed || redacted !== item;
      return redacted;
    });

    return changed ? items : value;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  let changed = false;
  const result: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    // An unset key is left visible: "no key configured" is exactly what one
    // needs to see when troubleshooting a failing request.
    if (SECRET_KEYS.has(key) && item !== undefined && item !== null && item !== "") {
      result[key] = REDACTED;
      changed = true;
      continue;
    }

    const redacted = redactValue(item, depth + 1);
    changed = changed || redacted !== item;
    result[key] = redacted;
  }

  return changed ? result : value;
};

/**
 * Return `value` with every credential replaced by {@link REDACTED}. The input
 * is never mutated, and the original reference is returned unchanged when it
 * carries no credential, so a log line without secrets stays exactly as it was.
 */
export const redactSecrets = <T>(value: T): T => redactValue(value, 0) as T;
