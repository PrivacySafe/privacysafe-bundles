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
  import { computed, type ComputedRef, defineAsyncComponent, inject, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { Ui3nButton, Ui3nIcon, type Nullable, type TaskRunnerInstance } from '@v1nt1248/3nclient-lib';
  import { DIALOGS_KEY, type DialogsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { appStorageSrv } from '@/services/services-provider';
  import { useAppStore, useSyncQueueStore } from '@/store';
  import { styleByStatus } from './constants';
  import type { ListingEntryExtended } from '@shared/types';
  import type { EntitySyncStatus } from '@deno/types.ts';

  const props = defineProps<{
    lockChanges?: boolean;
    taskRunner: TaskRunnerInstance;
    fsId: string;
    row: ListingEntryExtended;
  }>();
  const emits = defineEmits<{
    (event: 'refresh-data'): void;
  }>();

  const { t } = useI18n();

  const { $openDialog } = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const appStore = useAppStore();
  const syncQueueStore = useSyncQueueStore();
  const { uploadProcesses, downloadProcesses, adoptProcesses } = storeToRefs(syncQueueStore);
  const { upsertProcess, removeProcess } = syncQueueStore;

  const fsEntitySyncStatus = ref<EntitySyncStatus | undefined>(undefined);

  const syncStatusInner = ref<Nullable<EntitySyncStatus['state']>>(null);
  const syncStatusInProgress = ref(false);

  const path = computed(() => props.row.fullPath);
  const syncStatus = computed(() => props.row.sync);
  const isFsEntryInProcessing = computed(
    () =>
      uploadProcesses.value.has(props.row.fullPath) ||
      downloadProcesses.value.has(props.row.fullPath) ||
      adoptProcesses.value.has(props.row.fullPath),
  ) as ComputedRef<boolean>;

  const currentSyncStatus = computed(() => syncStatusInner.value || syncStatus.value);
  const style = computed(() => {
    return currentSyncStatus.value ? styleByStatus[currentSyncStatus.value] : undefined;
  });
  const textStyle = computed(() => ({
    color: style.value?.color || 'var(--color-text-control-secondary-default)',
  }));

  const showProgress = computed(
    () => (syncStatusInProgress.value || isFsEntryInProcessing.value) && appStore.connectivityStatus === 'online',
  );

  async function uploadLocal() {
    if (props.row.brokeReason) {
      return;
    }

    await appStorageSrv.startSyncUpload({ path: path.value });
  }

  async function adoptRemote() {
    if (props.row.brokeReason || !fsEntitySyncStatus.value?.remote?.latest) {
      return;
    }

    upsertProcess({ action: 'adoptRemote', path: path.value, value: true });
    appStorageSrv
      .startSyncAdopt({
        path: path.value,
        opts: { remoteVersion: fsEntitySyncStatus.value.remote.latest },
      })
      .then(() => {
        removeProcess({ action: 'adoptRemote', path: path.value });
      });
  }

  async function downloadFromRemote() {
    if (props.row.brokeReason) {
      return;
    }

    const entrySyncStatus = await appStorageSrv.getSyncedStatus({ fsId: props.fsId, fullPath: path.value });
    if (entrySyncStatus?.synced) {
      await appStorageSrv.startSyncDownload({
        path: path.value,
        version: entrySyncStatus.synced!.latest!,
      });
    }
  }

  async function resolveConflict() {
    if (props.row.brokeReason) {
      return;
    }

    const component = defineAsyncComponent(
      () => import('@/components/dialogs/resolve-conflicts-dialog/resolve-conflicts-dialog.vue'),
    );
    const res = await $openDialog<boolean | string>(component, {
      paths: [path.value],
      dialogProps: {
        title: '',
        width: 960,
        cssStyle: { borderRadius: '24px' },
        contentCssStyle: { borderRadius: '24px' },
        confirmButton: false,
        cancelButton: false,
        closeOnClickOverlay: false,
      },
    });

    if (res) {
      console.log('[###] CONFLICT RESOLVING RES => ', JSON.stringify(res), ' <> ', props.row.fullPath);
      const { event, data } = res;
      if (event === 'confirm') {
        emits('refresh-data');
      } else if (event === 'cancel' && typeof data === 'string' && props.row.fullPath === data) {
        getSyncStatus();
      }
    }
  }

  async function getSyncStatus() {
    // console.log(`# GET SYNC STATUS FOR [${path.value}] | FS_ID ${props.fsId} | CONNECTIVITY ${appStore.connectivityStatus}`);
    if (appStore.connectivityStatus === 'offline') {
      setTimeout(() => {
        getSyncStatus();
      }, 60000);
      return;
    }

    try {
      syncStatusInProgress.value = true;
      fsEntitySyncStatus.value = await appStorageSrv.getSyncedStatus({
        fsId: props.fsId,
        fullPath: path.value,
        stopErrorPropagate: true,
      });
      if (fsEntitySyncStatus.value) {
        syncStatusInner.value = fsEntitySyncStatus.value.state;

        if (['unsynced', 'behind'].includes(syncStatusInner.value)) {
          await appStorageSrv.addSyncQueueItem({
            path: path.value,
            status: 'pending',
            attempts: 0,
            lastError: '',
            lastChanged: Date.now(),
          });
        }
      }
    } catch (e) {
      if ((e as web3n.ConnectException).type !== 'connect') {
        console.error(`Error while the sync status getting for [${path.value}]. `, e);
      }
    } finally {
      syncStatusInProgress.value = false;
    }
  }

  watch(
    [() => props.lockChanges, () => isFsEntryInProcessing.value],
    ([lcVal, processFlagVal]) => {
      if (!lcVal && !processFlagVal) {
        getSyncStatus();
      }
    },
    {
      immediate: true,
    },
  );
</script>

<template>
  <div :class="$style.syncStatus">
    <template v-if="!showProgress">
      <ui3n-icon
        v-if="style"
        :icon="style.icon"
        :color="style.iconColor"
        size="10"
      />

      <span :style="textStyle">
        {{ currentSyncStatus }}
      </span>

      <div
        v-if="currentSyncStatus && currentSyncStatus !== 'synced' && !row.brokeReason"
        :class="$style.action"
      >
        <ui3n-button
          v-if="currentSyncStatus === 'unsynced'"
          type="custom"
          size="small"
          block
          color="var(--color-bg-button-secondary-default)"
          text-color="var(--color-text-button-secondary-default)"
          @click.stop.prevent="uploadLocal"
        >
          {{ t('app.upload') }}
        </ui3n-button>

        <ui3n-button
          v-if="currentSyncStatus === 'behind'"
          type="custom"
          size="small"
          block
          color="var(--color-bg-button-secondary-default)"
          text-color="var(--color-text-button-secondary-default)"
          @click.stop.prevent="adoptRemote"
        >
          {{ t('app.adopt') }}
        </ui3n-button>

        <ui3n-button
          v-if="currentSyncStatus === 'remote'"
          type="custom"
          size="small"
          block
          color="var(--color-bg-button-secondary-default)"
          text-color="var(--color-text-button-secondary-default)"
          @click.stop.prevent="downloadFromRemote"
        >
          {{ t('app.download') }}
        </ui3n-button>

        <ui3n-button
          v-if="currentSyncStatus === 'conflicting'"
          type="custom"
          size="small"
          block
          color="var(--color-bg-button-secondary-default)"
          text-color="var(--color-text-button-secondary-default)"
          @click.stop.prevent="resolveConflict"
        >
          {{ t('app.resolve') }}
        </ui3n-button>
      </div>
    </template>

    <div
      v-if="showProgress"
      :class="$style.progress"
    >
      <ui3n-icon
        v-if="syncStatusInProgress"
        icon="spinner-3-dots-scale"
        color="var(--color-bg-control-accent-default)"
        size="20"
      />

      <template v-else>
        <ui3n-icon
          v-if="uploadProcesses.has(row.fullPath) || downloadProcesses.has(row.fullPath)"
          :icon="uploadProcesses.has(row.fullPath) ? 'outline-file-upload' : 'outline-file-download'"
          color="var(--color-bg-control-accent-default)"
          size="20"
        />

        <span
          v-if="uploadProcesses.has(row.fullPath)"
          :class="$style.progressValue"
        >
          {{ ((uploadProcesses.get(row.fullPath)?.progress || 0) * 100).toFixed(1) }}%
        </span>

        <span
          v-if="downloadProcesses.has(row.fullPath)"
          :class="$style.progressValue"
        >
          {{ ((downloadProcesses.get(row.fullPath)?.progress || 0) * 100).toFixed(1) }}%
        </span>
      </template>
    </div>
  </div>
</template>

<style lang="scss" module>
  .syncStatus {
    position: relative;
    width: 100%;
    height: var(--spacing-ml);
    padding-right: var(--spacing-s);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: 2px;

    span {
      font-size: var(--font-10);
      font-weight: 600;
      line-height: 1;
    }

    &:hover {
      .action {
        opacity: 1;
        transition: opacity 0.15s ease-in;
      }
    }
  }

  .action {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    justify-content: center;
    align-items: center;
    opacity: 0;
    transition: opacity 0.15s ease-out;
    padding-right: var(--spacing-s);
    background-color: transparent;
  }

  .progress {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    background-color: transparent;
  }

  .progressValue {
    font-size: var(--font-16);
    font-weight: 600;
    color: var(--color-text-block-primary-default);
  }
</style>
