import { ref, computed, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { RootFsFolderView, FsListItem } from '@shared/types';
import { START_OF_SYSTEM_FS_ID, USER_DEVICE_FS, USER_FS } from '@shared/constants';
import { pickerStorageSrv } from '@picker/common/services/picker-storage.service';

export const usePickerFsStore = defineStore('picker-fs', () => {
  const { getFsList, getFsRootFolderList } = pickerStorageSrv;

  const fsList = shallowRef<Record<string, FsListItem>>({});
  const fsFolderList = ref<RootFsFolderView[]>([]);

  // Home, Device and System roots; local-user storage is intentionally not
  // exposed. Which of them a dialog mode offers is decided by
  // isRootAvailableInMode() (system roots: openFile only).
  const fsAvailableFolderList = computed(() =>
    fsFolderList.value.filter(
      folder =>
        folder.fsId === USER_FS || folder.fsId === USER_DEVICE_FS || folder.id.includes(START_OF_SYSTEM_FS_ID),
    ),
  );

  async function initializeFsItems(): Promise<void> {
    fsList.value = await getFsList();
    fsFolderList.value = await getFsRootFolderList();
  }

  return {
    fsList,
    fsAvailableFolderList,
    initializeFsItems,
  };
});
