<!--
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
-->
<script setup lang="ts">
  import { computed, inject, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import size from 'lodash/size';
  import {
    Ui3nButton,
    Ui3nCheckbox,
    Ui3nDialog,
    Ui3nIcon,
    Ui3nProgressCircular,
    Ui3nTooltip,
    type Nullable,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { getFileExtension } from '@v1nt1248/3nclient-lib/utils';
  import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { useFsStore, useSyncQueueStore } from '@/store';
  import {
    absorbRemoteFolderChanges as _absorbRemoteFolderChanges,
    adoptRemoteFolderItem,
    getFsStat,
  } from '@shared/utils/fs-utils';
  import { appStorageSrv } from '@/services/services-provider';
  import { AUTOMATIC_DOWNLOAD_FILE_LIMIT_SIZE, USER_FS } from '@shared/constants';
  import { formatPath, getParentFolderPathFromEntityFullPath } from '@shared/utils/various';
  import type { ListingEntryExtended } from '@shared/types';
  import EntityDataBlock from '@/components/dialogs/resolve-conflicts-dialog/entity-data-block.vue';
  import FolderCompareBlock from '@/components/dialogs/resolve-conflicts-dialog/folder-compare-block.vue';
  import { EntitySyncStatus } from '@deno/types.ts';

  const props = defineProps<{
    paths: string[];
    dialogProps?: Ui3nDialogComponentProps<boolean>;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: boolean | string }): void;
  }>();

  const { t } = useI18n();
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const fsStore = useFsStore();
  const { getFs, getEntityStats, getSyncedStatus } = fsStore;
  const { trashFolderName } = storeToRefs(fsStore);
  const { getRootFolderSyncStatus } = useSyncQueueStore();

  type ResolveAction = 'keepLocal' | 'keepCloud' | 'keepBoth' | 'absorb';

  const applyToAllObjects = ref(false);
  const currentResolvingPathIndex = ref(0);
  const currentResolvingPath = computed(() => formatPath(props.paths[currentResolvingPathIndex.value]));

  const showCompareFolderTable = ref(false);
  const totalResolvingItems = computed(() => size(props.paths));

  const syncStatus = ref<EntitySyncStatus | undefined>(undefined);
  const statsLocal = ref<Nullable<ListingEntryExtended & { thumbnail?: string }> | undefined>(null);
  const statsRemote = ref<Nullable<ListingEntryExtended & { thumbnail?: string }> | undefined>(null);
  const parentFolder = ref<Nullable<string>>(null);

  const isProcessOngoing = ref(false);

  /**
   * Shows the first path, starting from `index`, that is still conflicting.
   * Paths resolved meanwhile (e.g. on another device) are skipped.
   * Returns false when no conflicting path is left.
   */
  async function showConflictFrom(index: number): Promise<boolean> {
    for (let i = index; i < props.paths.length; i += 1) {
      currentResolvingPathIndex.value = i;
      const path = currentResolvingPath.value;
      const status = await getSyncedStatus({ fsId: USER_FS, fullPath: path });
      const remoteVersion = status?.remote?.latest;
      if (status?.state !== 'conflicting' || !remoteVersion) {
        continue;
      }

      syncStatus.value = status;
      statsLocal.value = await getEntityStats({ fsId: USER_FS, fullPath: path });
      statsRemote.value = await getEntityStats({ fsId: USER_FS, fullPath: path, version: remoteVersion });
      showCompareFolderTable.value = false;

      const home = t('fs.folder_name.user_synced_home');
      const currentParentFolder = getParentFolderPathFromEntityFullPath(path);
      parentFolder.value = currentParentFolder ? `${home} / ${currentParentFolder.replaceAll('/', ' / ')}` : home;
      return true;
    }
    return false;
  }

  function toggleFolderCompareDisplaying() {
    showCompareFolderTable.value = !showCompareFolderTable.value;
  }

  async function refreshRootStatuses(path: string) {
    if (path === '') {
      await getRootFolderSyncStatus('root');
      await getRootFolderSyncStatus('trash');
    } else if (path === trashFolderName.value) {
      await getRootFolderSyncStatus('trash');
    }
  }

  function isActionApplicable(action: ResolveAction): boolean {
    if (action === 'keepBoth') {
      return statsLocal.value?.type === 'file';
    }
    if (action === 'absorb') {
      return statsLocal.value?.type === 'folder';
    }
    return true;
  }

  async function keepLocal(path: string, remoteVersion: number) {
    await appStorageSrv.startSyncUpload({
      path,
      opts: { uploadVersion: remoteVersion + 1 },
      stopErrorPropagate: false,
    });
  }

  async function keepCloud(path: string, remoteVersion: number) {
    const fs = getFs(USER_FS);
    await appStorageSrv.startSyncAdopt({
      path,
      opts: { remoteVersion },
      stopErrorPropagate: false,
    });

    const stats = await getFsStat({ fs, path, stopErrorPropagate: true });

    const itShouldDownload =
      stats &&
      stats.isFile &&
      stats.versionSyncBranch === 'synced' &&
      stats.size &&
      stats.size <= AUTOMATIC_DOWNLOAD_FILE_LIMIT_SIZE &&
      stats.version;

    if (itShouldDownload) {
      await appStorageSrv.startSyncDownload({ path, version: stats.version! });
    } else {
      await appStorageSrv.deleteSyncQueueItem(path);
    }
  }

  async function keepBothFile(path: string) {
    const fs = getFs(USER_FS);
    const currentFileParentFolder = getParentFolderPathFromEntityFullPath(path);
    const currentFileFullName = path.replace(`${currentFileParentFolder}/`, '');
    const currentFileExt = getFileExtension(currentFileFullName);
    const currentFileName = currentFileExt
      ? currentFileFullName.replace(`.${currentFileExt}`, '')
      : currentFileFullName;
    const newItemName = `${currentFileName}_[ keep ]${currentFileExt ? `.${currentFileExt}` : ''}`;

    await adoptRemoteFolderItem({
      fs,
      path: currentFileParentFolder,
      remoteItemName: currentFileFullName,
      opts: { newItemName },
    });

    await appStorageSrv.startSyncUpload({ path: currentFileParentFolder, stopErrorPropagate: false });
    const stats = await getFsStat({ fs, path });

    if (
      stats &&
      stats.versionSyncBranch === 'synced' &&
      stats.size &&
      stats.size <= AUTOMATIC_DOWNLOAD_FILE_LIMIT_SIZE &&
      stats.version
    ) {
      await appStorageSrv.startSyncDownload({ path, version: stats.version });
    }
  }

  async function absorbRemoteFolderChanges(path: string, remoteVersion: number) {
    const fs = getFs(USER_FS);
    await _absorbRemoteFolderChanges({
      fs,
      path,
      opts: { postfixForNameOverlaps: '_[ keep ]' },
    });

    await appStorageSrv.startSyncUpload({
      path,
      opts: { uploadVersion: remoteVersion + 1 },
      stopErrorPropagate: false,
    });
  }

  async function performAction(action: ResolveAction) {
    const path = currentResolvingPath.value;
    const remoteVersion = syncStatus.value!.remote!.latest!;

    switch (action) {
      case 'keepLocal':
        return keepLocal(path, remoteVersion);
      case 'keepCloud':
        return keepCloud(path, remoteVersion);
      case 'keepBoth':
        return keepBothFile(path);
      case 'absorb':
        return absorbRemoteFolderChanges(path, remoteVersion);
    }
  }

  /**
   * Resolves the current conflict and moves to the next one. With "apply to
   * all", the same action goes on for the next conflicts while it fits them.
   * On an error the dialog stays at the failed conflict.
   */
  async function resolve(action: ResolveAction) {
    if (isProcessOngoing.value || !syncStatus.value?.remote?.latest) {
      return;
    }

    isProcessOngoing.value = true;
    try {
      let nextAction: ResolveAction | null = action;
      while (nextAction) {
        const path = currentResolvingPath.value;
        await performAction(nextAction);
        await refreshRootStatuses(path);

        const hasNextConflict = await showConflictFrom(currentResolvingPathIndex.value + 1);
        if (!hasNextConflict) {
          emits('action', { event: 'confirm', data: true });
          return;
        }

        nextAction = applyToAllObjects.value && isActionApplicable(action) ? action : null;
      }
    } catch (err) {
      w3n.log('error', `Error resolving the conflict of '${currentResolvingPath.value}'. `, err);
      notifications.$createNotice({
        type: 'error',
        withIcon: true,
        content: t('dialog.resolve.error', { name: currentResolvingPath.value || '/' }),
      });
    } finally {
      isProcessOngoing.value = false;
    }
  }

  onMounted(async () => {
    const hasConflict = await showConflictFrom(0).catch(err => {
      w3n.log('error', 'Error loading the conflict information. ', err);
      return false;
    });
    if (!hasConflict) {
      // nothing to resolve: the caller refreshes the status of the given path
      emits('action', { event: 'cancel', data: formatPath(props.paths[0]) });
    }
  });
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    @action="emits('action', $event)"
  >
    <template #header>
      <div :class="$style.header">
        <ui3n-icon
          icon="shield-check-outline"
          size="12"
          color="var(--info-outline-default)"
        />

        <span>{{ t('dialog.resolve.title') }}</span>
        <span v-if="totalResolvingItems > 1">
          &nbsp;({{ currentResolvingPathIndex + 1 }}/{{ totalResolvingItems }})
        </span>
      </div>
    </template>

    <template #body>
      <div :class="[$style.body, (showCompareFolderTable || totalResolvingItems < 2) && $style.bodyExpanded]">
        <div :class="$style.block">
          <entity-data-block
            branch="cloud"
            :stats="statsRemote"
            :parent-folder="parentFolder"
          />
        </div>

        <div :class="$style.block">
          <entity-data-block
            branch="local"
            :stats="statsLocal"
            :parent-folder="parentFolder"
          />
        </div>

        <div
          v-if="showCompareFolderTable"
          :class="$style.folderCompareBlock"
        >
          <folder-compare-block
            :path="paths[currentResolvingPathIndex]"
            :parent-folder="parentFolder!"
            :sync-status="syncStatus"
            :stats-local="statsLocal!"
            :stats-remote="statsRemote!"
          />
        </div>
      </div>
    </template>

    <template #actions>
      <div :class="[$style.actions, (showCompareFolderTable || totalResolvingItems < 2) && $style.actionsNarrow]">
        <ui3n-checkbox
          v-if="totalResolvingItems > 1 && !showCompareFolderTable"
          v-model="applyToAllObjects"
          :class="$style.applyFlag"
        >
          {{ t('dialog.resolve.checkbox_text') }}
        </ui3n-checkbox>

        <div :class="$style.btnsBlock">
          <ui3n-button
            v-if="statsLocal?.type === 'folder'"
            type="secondary"
            @click.stop.prevent="toggleFolderCompareDisplaying"
          >
            {{ showCompareFolderTable ? t('dialog.resolve.btn.back') : t('dialog.resolve.btn.compare') }}
          </ui3n-button>
        </div>

        <div :class="$style.btnsBlock">
          <ui3n-button
            type="secondary"
            @click.stop.prevent="resolve('keepCloud')"
          >
            {{ t('dialog.resolve.btn.keep_cloud') }}
          </ui3n-button>

          <ui3n-button
            type="secondary"
            @click.stop.prevent="resolve('keepLocal')"
          >
            {{ t('dialog.resolve.btn.keep_local') }}
          </ui3n-button>

          <ui3n-button
            v-if="statsLocal?.type === 'file'"
            @click.stop.prevent="resolve('keepBoth')"
          >
            {{ t('dialog.resolve.btn.keep_both') }}
          </ui3n-button>

          <template v-if="statsLocal?.type === 'folder'">
            <ui3n-button :disabled="true">
              {{ t('dialog.resolve.btn.merge') }}
            </ui3n-button>

            <ui3n-tooltip
              :content="t('dialog.resolve.btn.absorb_tooltip')"
              position-strategy="fixed"
              placement="top-end"
            >
              <ui3n-button @click.stop.prevent="resolve('absorb')">
                {{ t('dialog.resolve.btn.absorb') }}
              </ui3n-button>
            </ui3n-tooltip>
          </template>
        </div>
      </div>
    </template>

    <template
      v-if="isProcessOngoing"
      #loading
    >
      <ui3n-progress-circular
        v-if="isProcessOngoing"
        indeterminate
        size="80"
      />
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  @use '../../../assets/styles/mixins' as mixins;

  .header {
    display: flex;
    width: 100%;
    height: 48px;
    padding: 0 var(--spacing-m);
    border-bottom: 1px solid var(--color-border-block-primary-default);
    border-top-left-radius: var(--spacing-ml);
    border-top-right-radius: var(--spacing-ml);
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-xs);
    font-size: var(--font-12);
    font-weight: 500;
    color: var(--color-text-block-primary-default);
  }

  .closeBtn {
    position: absolute;
    right: 4px;
    top: 12px;
    z-index: 5;
  }

  .body {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 224px;
    justify-content: space-between;
    align-items: stretch;

    &.bodyExpanded {
      height: 368px;
    }
  }

  .folderCompareBlock {
    position: absolute;
    inset: 0;
    background-color: var(--color-bg-block-primary-default);
    z-index: 1;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .actions {
    position: relative;
    display: flex;
    width: 100%;
    padding: var(--spacing-ml) var(--spacing-m) 0 var(--spacing-m);
    height: 88px;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid var(--color-border-block-primary-default);

    &.actionsNarrow {
      height: 64px;
      padding-top: 0;
    }
  }

  .applyFlag {
    position: absolute;
    left: var(--spacing-m);
    top: var(--spacing-m);
  }

  .btnsBlock {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .block {
    position: relative;
    width: 100%;
    height: 50%;
  }
</style>
