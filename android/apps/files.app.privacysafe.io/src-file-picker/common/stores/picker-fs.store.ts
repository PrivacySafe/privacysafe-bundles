import { ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { RootFsFolderView, FsListItem } from '@shared/types';
import { pickerStorageSrv } from '@picker/common/services/picker-storage.service';

export const usePickerFsStore = defineStore('picker-fs', () => {
  const { getFsList, getFsRootFolderList } = pickerStorageSrv;

  const fsList = shallowRef<Record<string, FsListItem>>({});

  const fsAvailableFolderList = ref<RootFsFolderView[]>([]);

  async function initializeFsItems(): Promise<void> {
    fsList.value = await getFsList();
    fsAvailableFolderList.value = await getFsRootFolderList();
  }

  return {
    fsList,
    fsAvailableFolderList,
    initializeFsItems,
  };
});
