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
import { computed, defineAsyncComponent, inject, onBeforeMount, provide, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { DIALOGS_KEY, type DialogsPlugin, VUEBUS_KEY, type VueBusPlugin } from '@v1nt1248/3nclient-lib/plugins';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { useNavigation } from '@/composables/useNavigation';
import { useAppStore, useFsStore, useFavoriteStore, useRunModeInfoStore } from '@/store';
import {
  USER_FS,
  USER_DEVICE_FS,
  START_OF_SYSTEM_FS_ID,
  USER_LOCAL_FS,
  USER_TRASH_FOLDER,
  USER_TRASH_LOCAL_FOLDER,
} from '@shared/constants';
import type {
  AppGlobalEvents,
  FavoriteFolder,
  FsEntityInfoProps,
  FsEntityInfoProvideProps,
  RootFsFolderView,
} from '@shared/types';
import UpdateFolderNameDialog from '@/components/dialogs/update-folder-name-dialog.vue';

export function useDashboard() {
  const { t } = useI18n();
  const bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const dialogs = inject<DialogsPlugin>(DIALOGS_KEY)!;

  const { navigateToRouteSingle } = useNavigation();

  const appStore = useAppStore();
  const { setCommonLoading } = appStore;

  const fsStore = useFsStore();
  const { fsAvailableFolderList } = storeToRefs(fsStore);
  const { isEntityPresent, makeFolder, saveFileBaseOnOsFileSystemFile, removeFavoriteFolderFromList } = fsStore;

  const favoriteStore = useFavoriteStore();
  const { processedFavoriteFolders } = storeToRefs(favoriteStore);
  const { setFavoriteFolderListValue, getFavoriteFolderList } = favoriteStore;

  const runModeInfoStore = useRunModeInfoStore();
  const { processedPath, currentFsId, parentSelectedFolder } = storeToRefs(runModeInfoStore);

  const userFsFolders = computed(() =>
    fsAvailableFolderList.value.filter(f =>
      [`${USER_FS}-root`, `${USER_LOCAL_FS}-root`, USER_TRASH_FOLDER, USER_TRASH_LOCAL_FOLDER].includes(f.id),
    ),
  );
  const userDeviceFsFolders = computed(() =>
    fsAvailableFolderList.value.filter(f => f.fsId.includes(USER_DEVICE_FS)),
  );
  const systemFsFolders = computed(() =>
    fsAvailableFolderList.value.filter(f => f.fsId.includes(START_OF_SYSTEM_FS_ID)),
  );

  const displayedFsEntityInfo = ref<Nullable<FsEntityInfoProps>>(null);

  function isFolderSelected(folder: RootFsFolderView) {
    return folder.id === parentSelectedFolder.value;
  }

  async function selectFolder(folder: RootFsFolderView) {
    await navigateToRouteSingle({
      params: {
        rootFolderId: folder.id,
      },
      query: { path: '' },
    });

    bus.$emitter.emit('click:breadcrumb', void 0);
  }

  async function createFolder() {
    const res = await dialogs.$openDialog<{ oldName: string; newName: string }>(UpdateFolderNameDialog, {
      name: '',
      dialogProps: {
        title: t('dialog.create_folder.title'),
        confirmButtonText: t('dialog.create_folder.button.confirm'),
      },
    });

    const { event, data = {} } = res || {};
    const { newName } = data as { oldName: string; newName: string };
    if (event === 'confirm' && newName) {
      const newFolderPath = `${processedPath.value}/${newName}`;
      await makeFolder({ fsId: currentFsId.value!, path: newFolderPath });
      bus.$emitter.emit('create:folder', { fsId: currentFsId.value!, fullPath: newFolderPath });
    }
  }

  async function uploadFile() {
    const component = defineAsyncComponent(() => import('@/components/dialogs/upload-files-dialog.vue'));

    const res = await dialogs.$openDialog<File[]>(component, {
      currentFolder: processedPath.value,
      dialogProps: {
        title: '',
        cssStyle: {
          width: '95%',
          height: '90%',
        },
        confirmButton: false,
        cancelButton: false,
        closeOnClickOverlay: false,
      },
    });

    const { event, data } = res;
    if (event === 'confirm') {
      try {
        setCommonLoading(true);

        for (const file of data as File[]) {
          await saveFileBaseOnOsFileSystemFile({
            fsId: currentFsId.value!,
            uploadedFile: file,
            folderPath: processedPath.value,
            withThumbnail: true,
          });
        }

        bus.$emitter.emit('upload:file', {
          fsId: currentFsId.value!,
          fullPath: processedPath.value,
        });
      } finally {
        setCommonLoading(false);
      }
    }
  }

  async function goToFavoriteFolder(favoriteFolder: FavoriteFolder) {
    const { fsId, fullPath } = favoriteFolder;

    const parentFolder = fsAvailableFolderList.value.find(f => f.fsId === fsId && f.id.includes('-root'));

    const isFolderPresent = await isEntityPresent({ fsId, path: fullPath });

    if (isFolderPresent && parentFolder) {
      return navigateToRouteSingle({
        params: {
          rootFolderId: parentFolder!.id,
        },
        query: { path: fullPath },
      });
    } else {
      const component = defineAsyncComponent(() => import('@/components/dialogs/confirmation-dialog.vue'));

      const dialogRes = await dialogs.$openDialog(component, {
        dialogText: t('favorite_folder.warning.missing_text', { path: fullPath }),
        additionalDialogText: t('favorite_folder.warning.missing_question'),
        dialogProps: {
          title: t('dialog.warning.title'),
          confirmButtonBackground: 'var(--error-content-default)',
          confirmButtonColor: 'var(--error-fill-default)',
        },
      });
      if (dialogRes.event === 'confirm') {
        const res = await removeFavoriteFolderFromList(favoriteFolder.favId);
        setFavoriteFolderListValue(res || []);
      }
    }
  }

  function openFsEntityInfoBlock(data: Nullable<FsEntityInfoProps>) {
    displayedFsEntityInfo.value = data;
  }

  onBeforeMount(async () => {
    await getFavoriteFolderList();
  });

  provide<FsEntityInfoProvideProps>('fsEntityInfo', { displayedFsEntityInfo, openFsEntityInfoBlock });

  return {
    t,
    processedFavoriteFolders,
    userFsFolders,
    userDeviceFsFolders,
    systemFsFolders,
    displayedFsEntityInfo,
    isFolderSelected,
    selectFolder,
    createFolder,
    uploadFile,
    goToFavoriteFolder,
    openFsEntityInfoBlock,
  };
}
