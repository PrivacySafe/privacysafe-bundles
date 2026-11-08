import { describe, expect, it } from 'vitest';
import { getEffectiveMoveMode, isDropIntoItself, shouldResetMoveMode } from '../../../src/utils/drag-and-drop.ts';

// Regression for live testing item 5: a folder could be dropped into its own subfolder,
// and the request went to the Deno service, which refused it with an IPC error.
describe('isDropIntoItself', () => {
  const drop = (targetPath: string, folderPaths: string[], targetFsId = 'fs1') =>
    isDropIntoItself({ targetFsId, targetPath, sourceFsId: 'fs1', folderPaths });

  it('refuses the folder itself and its subfolders', () => {
    expect(drop('A', ['A'])).toBe(true);
    expect(drop('A/B', ['A'])).toBe(true);
    expect(drop('A/B/C', ['X', 'A'])).toBe(true);
  });

  it('accepts a sibling with the same name prefix', () => {
    expect(drop('AB', ['A'])).toBe(false);
    expect(drop('A-copy/B', ['A'])).toBe(false);
  });

  it('accepts the parent folder and the root', () => {
    expect(drop('', ['docs/A'])).toBe(false);
    expect(drop('/', ['docs/A'])).toBe(false);
    expect(drop('docs', ['docs/A'])).toBe(false);
  });

  it('treats paths with a leading slash or ./ as the same paths', () => {
    expect(drop('/A/B', ['A'])).toBe(true);
    expect(drop('./A', ['/A'])).toBe(true);
  });

  it('accepts the same path in another FS', () => {
    expect(drop('A/B', ['A'], 'fs2')).toBe(false);
  });

  it('accepts any target when only files are dragged', () => {
    expect(drop('A', [])).toBe(false);
  });
});

// Regression for live testing item 4: a quick drag used the toggle, and the toggle
// was reset by every drag.
describe('getEffectiveMoveMode', () => {
  it('moves a quick drag only with the hot key', () => {
    expect(getEffectiveMoveMode({ dragKind: 'quick', isMoveMode: true, isMoveModeQuick: false })).toBe(false);
    expect(getEffectiveMoveMode({ dragKind: 'quick', isMoveMode: false, isMoveModeQuick: true })).toBe(true);
  });

  it('moves the selection with the toggle or with the hot key', () => {
    expect(getEffectiveMoveMode({ dragKind: 'selection', isMoveMode: true, isMoveModeQuick: false })).toBe(true);
    expect(getEffectiveMoveMode({ dragKind: 'selection', isMoveMode: false, isMoveModeQuick: true })).toBe(true);
    expect(getEffectiveMoveMode({ dragKind: 'selection', isMoveMode: false, isMoveModeQuick: false })).toBe(false);
  });
});

describe('shouldResetMoveMode', () => {
  const base = { folderId: 'user-fs-root', path: 'docs', folder2Id: 'user-fs-root', path2: 'photos', activeWindow: '1' };

  it('keeps the toggle while nothing changes in its window', () => {
    expect(shouldResetMoveMode({ moveModeWindow: '1', isSplittedMode: true, now: base, before: base })).toBe(false);
  });

  it('keeps the toggle when the other window shows another folder', () => {
    const now = { ...base, path2: 'photos/2026' };
    expect(shouldResetMoveMode({ moveModeWindow: '1', isSplittedMode: true, now, before: base })).toBe(false);
  });

  it('resets the toggle when its window shows another folder', () => {
    expect(
      shouldResetMoveMode({ moveModeWindow: '1', isSplittedMode: true, now: { ...base, path: 'docs/a' }, before: base }),
    ).toBe(true);
    expect(
      shouldResetMoveMode({
        moveModeWindow: '2',
        isSplittedMode: true,
        now: { ...base, folder2Id: 'user-local-fs-root', activeWindow: '2' },
        before: { ...base, activeWindow: '2' },
      }),
    ).toBe(true);
  });

  it('resets the toggle when the other window becomes active', () => {
    const now = { ...base, activeWindow: '2' };
    expect(shouldResetMoveMode({ moveModeWindow: '1', isSplittedMode: true, now, before: base })).toBe(true);
  });

  // clicking the toggle in an inactive window makes that window active
  it('keeps the toggle when its own window becomes active', () => {
    const now = { ...base, activeWindow: '2' };
    expect(shouldResetMoveMode({ moveModeWindow: '2', isSplittedMode: true, now, before: base })).toBe(false);
  });

  it('ignores the active window outside of the split mode', () => {
    const now = { ...base, activeWindow: '2' };
    expect(shouldResetMoveMode({ moveModeWindow: '1', isSplittedMode: false, now, before: base })).toBe(false);
  });

  it('treats a missing path as the root', () => {
    const before = { ...base, path: undefined };
    expect(shouldResetMoveMode({ moveModeWindow: '1', isSplittedMode: false, now: { ...base, path: '' }, before })).toBe(
      false,
    );
  });
});
