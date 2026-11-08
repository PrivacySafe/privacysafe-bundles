/*
 Copyright (C) 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { isSameOrInside } from '@shared/utils/fs-utils/entity-name';
import { formatPath } from '@shared/utils/various';

/** 'selection': an entity of the selection is dragged with the whole selection; 'quick': a not selected entity alone. */
export type DragKind = 'selection' | 'quick';

export interface DragSource {
  fsId: string;
  /** paths of the dragged folders */
  folderPaths: string[];
}

/** True when the target is one of the dragged folders or lies inside one of them, in the same FS. */
export function isDropIntoItself({
  targetFsId,
  targetPath,
  sourceFsId,
  folderPaths,
}: {
  targetFsId: string;
  targetPath: string;
  sourceFsId: string;
  folderPaths: string[];
}): boolean {
  const target = formatPath(targetPath);
  return sourceFsId === targetFsId && folderPaths.some(folder => isSameOrInside(target, formatPath(folder)));
}

/**
 * A quick drag (of a not selected entity) moves only with the hot key held;
 * the selection moves with the toggle on or with the hot key.
 */
export function getEffectiveMoveMode({
  dragKind,
  isMoveMode,
  isMoveModeQuick,
}: {
  dragKind: Nullable<DragKind>;
  isMoveMode: boolean;
  isMoveModeQuick: boolean;
}): boolean {
  return dragKind === 'quick' ? isMoveModeQuick : isMoveMode || isMoveModeQuick;
}

export interface WindowsLocation {
  folderId?: string;
  path?: string;
  folder2Id?: string;
  path2?: string;
  activeWindow?: string;
}

/**
 * The MOVE toggle belongs to the window where it was turned on. It is turned off
 * when that window shows another folder, or when the other window becomes active
 * in the split mode. A switch to the window of the toggle keeps it: clicking the
 * toggle in an inactive window makes that window active.
 */
export function shouldResetMoveMode({
  moveModeWindow,
  isSplittedMode,
  now,
  before,
}: {
  moveModeWindow: '1' | '2';
  isSplittedMode: boolean;
  now: WindowsLocation;
  before: WindowsLocation;
}): boolean {
  const isFolderChanged =
    moveModeWindow === '2'
      ? now.folder2Id !== before.folder2Id || (now.path2 ?? '') !== (before.path2 ?? '')
      : now.folderId !== before.folderId || (now.path ?? '') !== (before.path ?? '');
  const isOtherWindowActive = isSplittedMode && !!now.activeWindow && now.activeWindow !== moveModeWindow;
  return isFolderChanged || isOtherWindowActive;
}
