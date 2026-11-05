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
import { formatPath } from '@shared/utils/various';
import { joinEntityPath } from '@shared/utils/fs-utils/entity-name';
import { appStorageSrv } from '@/services/services-provider';
import { type CreateLinkDialogData, getCreateLinkErrorKey } from '@/utils/create-link';
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
import { makeLogger } from '@shared/utils/logger';

const log = makeLogger('Dashboard');

export function useDashboard() {
  const { t } = useI18n();
  const bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const dialogs = inject<DialogsPlugin>(DIALOGS_KEY)!;

  const { navigateToRouteSingle } = useNavigation();

  const appStore = useAppStore();

  const fsStore = useFsStore();
  const { fsAvailableFolderList } = storeToRefs(fsStore);
  const { isEntityPresent, makeFolder, uploadOsFiles, removeFavoriteFolderFromList, getFs } = fsStore;

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

  /** Any entity (a folder, a file, a link) at the path; a failed check counts as free. */
  async function isNameTaken(fs: web3n.files.FS, path: string): Promise<boolean> {
    const presence = await Promise.all([
      fs.checkFolderPresence(path).catch(() => false),
      fs.checkFilePresence(path).catch(() => false),
      fs.checkLinkPresence(path).catch(() => false),
    ]);
    return presence.some(Boolean);
  }

  async function createFolder() {
    // the target folder is fixed when the dialog opens, as the name is checked in it
    const fsId = currentFsId.value!;
    const parentPath = processedPath.value;
    const res = await dialogs.$openDialog<{ oldName: string; newName: string }>(UpdateFolderNameDialog, {
      name: '',
      checkNameTaken: (name: string) => isNameTaken(getFs(fsId), joinEntityPath(formatPath(parentPath), name)),
      dialogProps: {
        title: t('dialog.create_folder.title'),
        confirmButtonText: t('dialog.create_folder.button.confirm'),
      },
    });

    const { event, data = {} } = res || {};
    const { newName } = data as { oldName: string; newName: string };
    if (event === 'confirm' && newName) {
      const newFolderPath = `${parentPath}/${newName}`;
      try {
        // the shown folder may have been renamed or removed: a folder must not be created by its
        // old path, as that would also create a new parent folder with the old name
        if (formatPath(parentPath) && !(await isEntityPresent({ fsId, path: parentPath }))) {
          appStore.$createNotice({
            type: 'error',
            withIcon: true,
            content: t('fs.target_folder_missing', { path: parentPath }),
          });
          return;
        }

        if (await isNameTaken(getFs(fsId), newFolderPath)) {
          appStore.$createNotice({
            type: 'error',
            withIcon: true,
            content: t('fs.name_taken', { name: newName }),
          });
          return;
        }

        await makeFolder({ fsId, path: newFolderPath });
        bus.$emitter.emit('create:folder', { fsId, fullPath: newFolderPath });
      } catch (err) {
        log.error('Error creating a folder. ', err);
        appStore.$createNotice({
          type: 'error',
          withIcon: true,
          content: t('fs.create_folder_error', { name: newName }),
        });
      }
    }
  }

  /**
   * Creates a SymLink in the folder shown in the active window; the folder may
   * itself be behind a link. The target is picked in the dialog with the
   * platform's file dialogs; which targets fit is decided by the platform.
   */
  async function createLink() {
    const component = defineAsyncComponent(() => import('@/components/dialogs/create-link-dialog.vue'));

    // the target folder is fixed when the dialog opens: the user may navigate meanwhile
    const fsId = currentFsId.value!;
    const parentPath = formatPath(processedPath.value);
    const res = await dialogs.$openDialog<CreateLinkDialogData>(component, {
      checkNameTaken: (name: string) => isNameTaken(getFs(fsId), joinEntityPath(parentPath, name)),
      dialogProps: {
        title: t('dialog.create_link.title'),
        confirmButtonText: t('dialog.create_link.button.confirm'),
      },
    });

    const { event, data } = res || {};
    if (event !== 'confirm' || !data?.name || !data.target) {
      return;
    }

    const { name, target } = data;
    const linkPath = joinEntityPath(parentPath, name);
    const notifyError = (key: string) =>
      appStore.$createNotice({ type: 'error', withIcon: true, content: t(key, { name }) });

    try {
      const fs = getFs(fsId);
      if (parentPath && !(await fs.checkFolderPresence(parentPath))) {
        appStore.$createNotice({
          type: 'error',
          withIcon: true,
          content: t('fs.target_folder_missing', { path: parentPath }),
        });
        return;
      }

      // checked in the dialog too; the name may have been taken since
      if (await isNameTaken(fs, linkPath)) {
        notifyError('fs.name_taken');
        return;
      }

      await fs.link(linkPath, target);

      if (fsId === USER_FS) {
        // the new link node and its folder are uploaded by the queue (the path may go through links)
        await appStorageSrv.addSyncQueueItem({
          path: linkPath,
          status: 'pending',
          attempts: 0,
          lastError: '',
          lastChanged: Date.now(),
        });
      }

      bus.$emitter.emit('create:folder', { fsId, fullPath: linkPath });
    } catch (err) {
      log.error(`Error creating the SymLink '${linkPath}'. `, err);
      notifyError(getCreateLinkErrorKey(err));
    }
  }

  async function uploadFile() {
    const component = defineAsyncComponent(() => import('@/components/dialogs/upload-files-dialog.vue'));

    // the target is fixed when the dialog opens: the user may navigate meanwhile
    const fsId = currentFsId.value!;
    const folderPath = processedPath.value;
    const res = await dialogs.$openDialog<File[]>(component, {
      currentFolder: folderPath,
      upload: (files: File[], onProgress: (fileIndex: number, bytesWritten: number) => void) =>
        uploadOsFiles({ fsId, files, folderPath, withThumbnail: true, onProgress }),
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

    if (res.event === 'confirm') {
      bus.$emitter.emit('upload:file', { fsId, fullPath: folderPath });
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
        // undefined means a failure: the current list must not be replaced by an empty one
        if (res) {
          setFavoriteFolderListValue(res);
        } else {
          appStore.$createNotice({ type: 'error', withIcon: true, content: t('fs.favorite_error') });
        }
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
    createLink,
    uploadFile,
    goToFavoriteFolder,
    openFsEntityInfoBlock,
  };
}
