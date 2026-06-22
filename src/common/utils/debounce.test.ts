import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes the wrapped function only after the delay elapses", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);

    debounced("a");
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(499);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
  });

  it("collapses rapid calls into a single trailing invocation with the latest args", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);

    debounced("a");
    vi.advanceTimersByTime(200);
    debounced("ab");
    vi.advanceTimersByTime(200);
    debounced("abc");

    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("abc");
  });

  it("cancel drops a pending invocation", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);

    debounced("a");
    debounced.cancel();
    vi.advanceTimersByTime(500);

    expect(fn).not.toHaveBeenCalled();
  });

  it("flush invokes a pending call immediately", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);

    debounced("a");
    debounced.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");

    // No trailing invocation after flush.
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush with no pending call does nothing", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);

    debounced.flush();
    expect(fn).not.toHaveBeenCalled();
  });
});
