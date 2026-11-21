import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../../../shared/utils/processes/map-with-concurrency.ts';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('mapWithConcurrency', () => {
  it('keeps the order of the items', async () => {
    const res = await mapWithConcurrency([30, 10, 20], 2, async (ms, i) => {
      await new Promise(resolve => setTimeout(resolve, ms));
      return i;
    });
    expect(res).toEqual([0, 1, 2]);
  });

  it('runs at most `limit` calls at a time', async () => {
    let running = 0;
    let maxRunning = 0;

    await mapWithConcurrency(Array.from({ length: 20 }), 3, async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await tick();
      running -= 1;
    });

    expect(maxRunning).toBe(3);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it('rejects when a call fails', async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async n => {
        if (n === 2) {
          throw new Error('boom');
        }
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
