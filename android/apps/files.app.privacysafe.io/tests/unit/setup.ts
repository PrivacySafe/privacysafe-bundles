import { beforeEach, vi } from 'vitest';

// The Deno and shared code expect the platform-injected `w3n` global.
// Only the parts that are touched by the code under test are stubbed here.
(globalThis as unknown as { w3n: unknown }).w3n = {
  log: vi.fn(async () => {}),
};

beforeEach(() => {
  // The code under test logs heavily with console.log; keep test output readable.
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
