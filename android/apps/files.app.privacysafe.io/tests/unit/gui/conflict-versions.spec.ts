import { describe, expect, it } from 'vitest';
import { areConflictVersionsSame } from '../../../src/utils/conflict-versions.ts';

const common = {
  currentVersion: 6,
  isCurrentLocal: true,
  remoteVersion: 6,
  isRemoteRemoved: false,
  syncedVersion: 5,
  mtime: { current: new Date(1), remote: new Date(2), synced: new Date(0) },
};

describe('areConflictVersionsSame', () => {
  // Live test, round 2, item 17: the local and the remote v6 of a folder were the same bytes
  it('takes folder versions with the same entries as the same, whatever the times', () => {
    expect(areConflictVersionsSame({ ...common }, 'folder')).toBe(true);
  });

  it.each([
    ['an entry added locally', { added: { inLocal: ['a'] } }],
    ['an entry added remotely', { added: { inRemote: ['a'] } }],
    ['an entry removed', { removed: { inLocal: ['a'] } }],
    ['a renamed entry', { renamed: [{ local: 'a', remote: 'b', renamedIn: 'l' as const }] }],
    ['a rekeyed entry', { rekeyed: [{ local: 'a', remote: 'a', rekeyedIn: 'r' as const }] }],
    ['a name overlap', { nameOverlaps: ['a'] }],
    ['a different xattr', { xattrs: { tags: { changedIn: 'l' as const } } }],
    ['a removed remote', { isRemoteRemoved: true }],
  ])('sees folder versions with %s as different', (_name, change) => {
    expect(areConflictVersionsSame({ ...common, ...change }, 'folder')).toBe(false);
  });

  it('compares files by their content and xattrs', () => {
    expect(areConflictVersionsSame({ ...common, areContentsSame: true }, 'file')).toBe(true);
    expect(areConflictVersionsSame({ ...common, areContentsSame: false }, 'file')).toBe(false);
    expect(
      areConflictVersionsSame({ ...common, areContentsSame: true, xattrs: { id: { addedIn: 'r' } } }, 'file'),
    ).toBe(false);
  });

  it('does not take an unknown diff as the same', () => {
    expect(areConflictVersionsSame(undefined, 'folder')).toBe(false);
  });
});
