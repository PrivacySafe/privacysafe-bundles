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
<!--
 What is in the automatic backups, BEFORE anything is restored from them: when
 each device last saved its copy, and how much is in it. The user picks the
 devices; all of them are picked to begin with.

 This device's own copy is shown for its date only and cannot be picked: it
 holds nothing this device does not have.
-->
<script lang="ts" setup>
  import { computed, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    Ui3nCheckbox,
    Ui3nDialog,
    Ui3nProgressLinear,
    type Ui3nCheckboxValue,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { chatService } from '@main/common/services/external-services';
  import { makeLogger } from '@shared/logger';
  import type { AutoBackupListing } from '~/auto-backup.types';

  const log = makeLogger('AutoBackupRestore');

  defineProps<{
    dialogProps?: Ui3nDialogComponentProps<string[]>;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: string[] }): void;
  }>();

  const { t } = useI18n();

  const loading = ref(true);
  const failed = ref(false);
  const listing = ref<AutoBackupListing>({ items: [], unreadable: 0 });
  const picked = ref<Record<string, Ui3nCheckboxValue>>({});

  const ownItem = computed(() => listing.value.items.find(item => item.isThisDevice));
  const otherItems = computed(() => listing.value.items.filter(item => !item.isThisDevice));
  const pickedIds = computed(() => otherItems.value
    .map(item => item.deviceId)
    .filter(id => picked.value[id] === true));

  function dateOf(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  onMounted(async () => {
    try {
      listing.value = await chatService.listAutoBackups();
      picked.value = Object.fromEntries(otherItems.value.map(item => [item.deviceId, true]));
    } catch (err) {
      log.error('Could not list the automatic backups', err);
      failed.value = true;
    } finally {
      loading.value = false;
    }
  });

  function handleAction(e: { event: Ui3nDialogEvent }) {
    if (e.event === 'confirm') {
      if (pickedIds.value.length === 0) {
        return;
      }
      emits('action', { event: 'confirm', data: pickedIds.value });
      return;
    }
    emits('action', e);
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :is-valid="!loading && pickedIds.length > 0"
    @action="handleAction"
  >
    <template #body>
      <div :class="$style.body">
        <template v-if="loading">
          <div :class="$style.text">
            {{ t('autoBackup.restore.loading') }}
          </div>
          <ui3n-progress-linear
            bg-color="transparent"
            height="4"
            indeterminate
          />
        </template>

        <div
          v-else-if="failed"
          :class="[$style.text, $style.error]"
        >
          {{ t('autoBackup.restore.listError') }}
        </div>

        <template v-else>
          <div :class="$style.text">
            {{ ownItem
              ? t('autoBackup.restore.thisDeviceLast', { date: dateOf(ownItem.writtenAt) })
              : t('autoBackup.restore.thisDeviceNone') }}
          </div>

          <div
            v-if="otherItems.length === 0"
            :class="$style.text"
          >
            {{ t('autoBackup.restore.empty') }}
          </div>

          <div
            v-else
            :class="$style.list"
          >
            <div
              v-for="item in otherItems"
              :key="item.deviceId"
              :class="$style.item"
            >
              <ui3n-checkbox v-model="picked[item.deviceId]">
                <div :class="$style.itemInfo">
                  <b>{{ t('autoBackup.restore.written', { date: dateOf(item.writtenAt) }) }}</b>
                  <span>{{ t('autoBackup.restore.device', { id: item.deviceId }) }}</span>
                  <span>
                    {{ t('autoBackup.restore.counts', { chats: item.chatsCount, messages: item.messagesCount }) }}
                  </span>
                </div>
              </ui3n-checkbox>
            </div>
          </div>

          <div
            v-if="listing.unreadable > 0"
            :class="[$style.text, $style.error]"
          >
            {{ t('autoBackup.restore.unreadable', { count: listing.unreadable }) }}
          </div>

          <div
            v-if="otherItems.length > 0"
            :class="$style.hint"
          >
            {{ t('autoBackup.restore.hint') }}
          </div>
        </template>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .body {
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-s);
    padding: var(--spacing-m);
  }

  .text {
    font-size: var(--font-14);
    line-height: var(--font-20);
    color: var(--color-text-block-primary-default);

    &.error {
      color: var(--error-content-default);
    }
  }

  .list {
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-s);
    max-height: 300px;
    overflow-y: auto;
  }

  .item {
    padding: var(--spacing-s);
    border: 1px solid var(--color-border-block-primary-default);
    border-radius: var(--spacing-s);
  }

  .itemInfo {
    display: flex;
    flex-direction: column;
    font-size: var(--font-12);
    line-height: var(--font-16);
    color: var(--color-text-block-primary-default);
    word-break: break-all;
  }

  .hint {
    font-size: var(--font-12);
    line-height: var(--font-16);
    color: var(--color-text-block-secondary-default);
  }
</style>
