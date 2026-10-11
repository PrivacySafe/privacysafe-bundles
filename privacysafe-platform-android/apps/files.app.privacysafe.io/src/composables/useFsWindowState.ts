import { computed, type ComputedRef } from 'vue';
import { storeToRefs } from 'pinia';
import { useAppStore, useFsStore } from '@/store';
import { useNavigation } from '@/composables/useNavigation';
import {
  USER_FS,
  START_OF_SYSTEM_FS_ID,
  USER_LOCAL_FS,
  USER_TRASH_FOLDER,
  USER_TRASH_LOCAL_FOLDER,
} from '@shared/constants';

export function useFsWindowState(fsWindowNumber: ComputedRef<'1' | '2'>) {
  const {
    isSplittedMode,
    window1FsId,
    window1RootFolderId,
    window1FolderPath,
    window1SortBy,
    window1SortOrder,
    window2FsId,
    window2RootFolderId,
    window2FolderPath,
    window2SortBy,
    window2SortOrder,
  } = useNavigation();

  const { trashFolderName } = storeToRefs(useAppStore());
  const { fsList } = storeToRefs(useFsStore());

  const currentWindowFsId = computed(() => (fsWindowNumber.value === '1' ? window1FsId.value : window2FsId.value!));

  const currentWindowFs = computed(() => Object.values(fsList.value).find(fs => fs.fsId === currentWindowFsId.value));

  const currentWindowRootFolderId = computed(() =>
    fsWindowNumber.value === '1' ? window1RootFolderId.value : window2RootFolderId.value!,
  );

  const currentWindowRootFolderBasePath = computed(() =>
    [USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER].includes(currentWindowRootFolderId.value) ? trashFolderName.value : '',
  );

  const currentWindowFolderPath = computed(() =>
    fsWindowNumber.value === '1' ? window1FolderPath.value : window2FolderPath.value!,
  );

  const currentWindowSortConfig = computed(() => ({
    field: fsWindowNumber.value === '1' ? window1SortBy.value : window2SortBy.value,
    direction: fsWindowNumber.value === '1' ? window1SortOrder.value : window2SortOrder.value,
  }));

  const isSyncFolderInCurrentWindow = computed(() => currentWindowRootFolderId.value.includes('synced'));

  const isTrashFolderInCurrentWindow = computed(() => {
    if ((isSplittedMode.value && fsWindowNumber.value === '1') || !isSplittedMode.value) {
      return (
        (window1FsId.value === USER_FS && window1RootFolderId.value === USER_TRASH_FOLDER) ||
        (window1FsId.value === USER_LOCAL_FS && window1RootFolderId.value === USER_TRASH_LOCAL_FOLDER)
      );
    }

    return (
      (window2FsId.value === USER_FS && window2RootFolderId.value === USER_TRASH_FOLDER) ||
      (window2FsId.value === USER_LOCAL_FS && window2RootFolderId.value === USER_TRASH_LOCAL_FOLDER)
    );
  });

  const isSystemFolderInCurrentWindow = computed(() => {
    if ((isSplittedMode.value && fsWindowNumber.value === '1') || !isSplittedMode.value) {
      return !Array.isArray(window1FsId.value) && window1FsId.value?.includes(START_OF_SYSTEM_FS_ID);
    }

    return !Array.isArray(window2FsId.value) && window2FsId.value?.includes(START_OF_SYSTEM_FS_ID);
  });

  return {
    currentWindowFsId,
    currentWindowFs,
    currentWindowRootFolderId,
    currentWindowRootFolderBasePath,
    currentWindowFolderPath,
    currentWindowSortConfig,
    isSyncFolderInCurrentWindow,
    isTrashFolderInCurrentWindow,
    isSystemFolderInCurrentWindow,
  };
}
