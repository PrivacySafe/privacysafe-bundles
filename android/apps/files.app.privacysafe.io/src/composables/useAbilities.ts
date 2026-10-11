/*
 Copyright (C) 2025 3NSoft Inc.

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
import { computed } from 'vue';
import isEmpty from 'lodash/isEmpty';
import { type Nullable } from '@v1nt1248/3nclient-lib';
import { useNavigation } from '@/composables/useNavigation';
import {
  USER_FS,
  USER_DEVICE_FS,
  END_OF_ROOT_FOLDER_ID,
  START_OF_SYSTEM_FS_ID,
  USER_TRASH_FOLDER,
  USER_TRASH_LOCAL_FOLDER,
  USER_LOCAL_FS,
} from '@shared/constants';
import type { ListingEntryExtended } from '@shared/types';

export function useAbilities() {
  const { isSplittedMode, activeWindow, window1RootFolderId, window2RootFolderId } = useNavigation();

  const canCreateFolder = computed(() => {
    if ((isSplittedMode.value && activeWindow.value === '1') || !isSplittedMode.value) {
      if ([USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER].includes(window1RootFolderId.value)) {
        return false;
      }

      return [`${USER_FS}-root`, `${USER_LOCAL_FS}-root`, `${USER_DEVICE_FS}-root`].includes(window1RootFolderId.value);
    }

    if ([USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER].includes(window2RootFolderId.value!)) {
      return false;
    }

    return [`${USER_FS}-root`, `${USER_LOCAL_FS}-root`, `${USER_DEVICE_FS}-root`].includes(window2RootFolderId.value!);
  });

  function canSetUnsetFavorite(currentFsId: Nullable<string>, currentRootFolderId: string): boolean {
    if (!currentFsId || [USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER].includes(currentRootFolderId)) {
      return false;
    }

    return (
      [USER_FS, USER_LOCAL_FS, USER_DEVICE_FS].includes(currentFsId) &&
      currentRootFolderId.includes(END_OF_ROOT_FOLDER_ID)
    );
  }

  function canDownload(selectedEntities: ListingEntryExtended[]): boolean {
    return !selectedEntities.some(entity => entity.brokeReason);
  }

  function canRestore({
    currentFsId,
    currentRootFolderId,
    currentFolderPath,
    selectedEntities,
  }: {
    currentFsId: Nullable<string>;
    currentRootFolderId: string;
    currentFolderPath?: string;
    selectedEntities: ListingEntryExtended[];
  }): boolean {
    if (!currentFsId) {
      return false;
    }

    return (
      [USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER].includes(currentRootFolderId) &&
      !currentFolderPath &&
      !selectedEntities.some(entity => entity.brokeReason)
    );
  }

  function canDelete(currentFsId: Nullable<string>, currentRootFolderId: string): boolean {
    if (!currentFsId) {
      return false;
    }

    return (
      [USER_FS, USER_LOCAL_FS, USER_DEVICE_FS].includes(currentFsId) &&
      ![USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER].includes(currentRootFolderId)
    );
  }

  function canDeleteCompletely(
    currentFsId: Nullable<string>,
    currentRootFolderId: string,
    currentFolderPath?: string,
  ): boolean {
    if (!currentFsId) {
      return false;
    }

    return [USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER].includes(currentRootFolderId)
      ? !currentFolderPath
      : !currentFsId.includes(START_OF_SYSTEM_FS_ID);
  }

  function canUpload(currentFsId: Nullable<string>, currentRootFolderId: string): boolean {
    if (!currentFsId || [USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER].includes(currentRootFolderId)) {
      return false;
    }

    return (
      [USER_FS, USER_LOCAL_FS, USER_DEVICE_FS].includes(currentFsId) &&
      currentRootFolderId.includes(END_OF_ROOT_FOLDER_ID)
    );
  }

  function canRename(currentFsId: Nullable<string>, currentRootFolderId: string): boolean {
    if (!currentFsId || [USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER].includes(currentRootFolderId)) {
      return false;
    }

    return (
      [USER_FS, USER_LOCAL_FS, USER_DEVICE_FS].includes(currentFsId) &&
      currentRootFolderId.includes(END_OF_ROOT_FOLDER_ID)
    );
  }

  function canCopyMove(currentRootFolderId: string): boolean {
    return ![USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER].includes(currentRootFolderId);
  }

  function canDrop(currentFsId: Nullable<string>, currentRootFolderId: string): boolean {
    if (!currentFsId || [USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER].includes(currentRootFolderId)) {
      return false;
    }

    return [USER_FS, USER_LOCAL_FS, USER_DEVICE_FS].includes(currentFsId);
  }

  function canResolve(currentFsId: Nullable<string>, selectedEntities: ListingEntryExtended[]): boolean {
    if (!currentFsId || currentFsId !== USER_FS || isEmpty(selectedEntities)) {
      return false;
    }

    return !selectedEntities.some(entity => entity.sync !== 'conflicting');
  }

  return {
    canCreateFolder,
    canSetUnsetFavorite,
    canDownload,
    canRestore,
    canDelete,
    canDeleteCompletely,
    canUpload,
    canRename,
    canCopyMove,
    canDrop,
    canResolve,
  };
}
