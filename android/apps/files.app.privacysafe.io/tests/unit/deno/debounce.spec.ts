import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from '../../../src_deno/utils/debounce.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('debounce', () => {
  it('calls once after the calls stop, with the last arguments', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced(1);
    debounced(2);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);
  });

  // Regression for plan 2.11: without maxWait a constantly changing sync queue
  // postponed its save forever.
  it('does not postpone longer than maxWait under constant calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100, { maxWait: 300 });

    for (let t = 0; t < 1000; t += 50) {
      debounced(t);
      vi.advanceTimersByTime(50);
    }

    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('runs a pending call on flush and not again later', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100, { maxWait: 300 });

    debounced('x');
    debounced.flush();
    expect(fn).toHaveBeenCalledWith('x');

    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does nothing on flush without a pending call', () => {
    const fn = vi.fn();
    debounce(fn, 100).flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('drops a pending call on cancel', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100, { maxWait: 300 });

    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(1000);

    expect(fn).not.toHaveBeenCalled();
  });

  it('keeps the immediate mode: the first call runs at once, the following ones are swallowed', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100, { immediate: true });

    debounced(1);
    debounced(2);
    vi.advanceTimersByTime(200);
    debounced(3);

    expect(fn.mock.calls).toEqual([[1], [3]]);
  });
});
