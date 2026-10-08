<!--
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
-->
<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { styleByStatus } from './constants';
  import { useAppStore } from '@/common/stores/app.store';
  import { useRecordStore } from '@/common/stores/record.store';
  import type { SyncType, TreasureRecord } from '@shared/@types';

  const props = defineProps<{
    record: TreasureRecord;
    syncProcess?: { type: SyncType; value: number };
  }>();

  const appStore = useAppStore();
  const { getRecordSyncStatus } = useRecordStore();

  const gettingSyncStatusInProgress = ref(false);
  const syncStatus = ref<web3n.files.SyncStatus | undefined>(undefined);

  const recordId = computed(() => props.record.id);
  const lockChanges = computed(() => !!props.syncProcess);
  const showProgress = computed(
    () => (gettingSyncStatusInProgress.value || props.syncProcess) && appStore.connectivityStatus === 'online',
  );

  const displayStyle = computed(() =>
    syncStatus.value?.state ? styleByStatus[syncStatus.value.state] : undefined,
  );
  const textStyle = computed(() => ({
    color: displayStyle.value?.color || 'var(--color-text-control-secondary-default)',
  }));

  async function getSyncStatus() {
    if (appStore.connectivityStatus === 'offline') {
      setTimeout(() => {
        getSyncStatus();
      }, 60000);
      return;
    }

    try {
      gettingSyncStatusInProgress.value = true;
      syncStatus.value = await getRecordSyncStatus(recordId.value);
    } catch (err) {
      if ((err as web3n.ConnectException).type !== 'connect') {
        console.error(`Error while the sync status getting for [${recordId.value}]. `, err);
      }
    } finally {
      gettingSyncStatusInProgress.value = false;
    }
  }

  watch(
    () => props.record.withoutSync,
    (val, oldVal) => {
      if (val && val !== oldVal) {
        syncStatus.value = {
          state: 'unsynced',
        };
      }
    },
    {
      immediate: true,
    },
  );

  watch(
    [lockChanges, () => appStore.connectivityStatus],
    async ([lockVal, cStatusVal]) => {
      if (!lockVal && cStatusVal === 'online') {
        await getSyncStatus();
      }
    },
    {
      immediate: true,
    },
  );
</script>

<template>
  <div :class="$style.recordSyncStatus">
    <div
      v-if="showProgress"
      :class="$style.progress"
    >
      <ui3n-icon
        v-if="gettingSyncStatusInProgress"
        icon="spinner-3-dots-scale"
        color="var(--color-bg-control-accent-default)"
        size="20"
      />

      <template v-else>
        <ui3n-icon
          :icon="syncProcess!.type === 'upload' ? 'outline-file-upload' : 'outline-file-download'"
          color="var(--color-bg-control-accent-default)"
          size="20"
        />

        <span
          v-if="syncProcess!.value"
          :class="$style.progressValue"
        >
          {{ ((syncProcess!.value || 0) * 100).toFixed(1) }}
        </span>
      </template>
    </div>

    <template v-else>
      <ui3n-icon
        v-if="displayStyle"
        :icon="displayStyle.icon"
        :color="displayStyle.iconColor"
        size="14"
      />

      <span
        :class="$style.text"
        :style="textStyle"
      >
        {{ syncStatus?.state || '-' }}
      </span>
    </template>
  </div>
</template>

<style lang="scss" module>
  .recordSyncStatus {
    position: relative;
    width: 100%;
    height: var(--spacing-ml);
    padding-right: var(--spacing-s);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: 2px;
  }

  .text {
    font-size: var(--font-12);
    font-weight: 500;
    line-height: var(--font-14);
    text-transform: capitalize;
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
