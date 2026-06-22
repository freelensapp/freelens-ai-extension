export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Cancel a pending invocation without calling the wrapped function. */
  cancel(): void;
  /** Immediately invoke a pending call (if any) and clear the timer. */
  flush(): void;
}

/**
 * Returns a debounced wrapper around `fn` that delays invocation until `delay`
 * milliseconds have elapsed since the last call (trailing edge). Only the most
 * recent arguments are used. The returned function exposes `cancel` and `flush`
 * so callers can drop or force the pending call (e.g. on unmount).
 */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: A | null = null;

  const debounced = ((...args: A) => {
    pendingArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const args = pendingArgs;
      pendingArgs = null;
      if (args) fn(...args);
    }, delay);
  }) as Debounced<A>;

  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pendingArgs = null;
  };

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pendingArgs) {
      const args = pendingArgs;
      pendingArgs = null;
      fn(...args);
    }
  };

  return debounced;
}
