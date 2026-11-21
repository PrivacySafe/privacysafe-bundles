import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOperatingSystem } from '../../../shared/utils/operating-system.ts';

afterEach(() => vi.unstubAllGlobals());

describe('getOperatingSystem', () => {
  it.each([
    [{ userAgentData: { platform: 'macOS' }, platform: '' }, 'macos'],
    [{ userAgentData: { platform: 'Windows' }, platform: '' }, 'windows'],
    [{ userAgentData: { platform: 'Linux' }, platform: '' }, 'linux'],
    [{ platform: 'MacIntel' }, 'macos'],
    [{ platform: 'Win32' }, 'windows'],
    [{ platform: '' }, 'linux'],
  ])('maps %j to %s', (nav, expected) => {
    vi.stubGlobal('navigator', nav);
    expect(getOperatingSystem()).toBe(expected);
  });
});
