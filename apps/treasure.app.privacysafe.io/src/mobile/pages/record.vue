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
  import { computed, inject } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import { storeToRefs } from 'pinia';
  import { DIALOGS_KEY, NOTIFICATIONS_KEY } from '@v1nt1248/3nclient-lib/plugins';
  import { Ui3nButton, Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import { APP_ROUTES } from '@/common/constants';
  import { useRecordStore } from '@/common/stores/record.store';
  import { useRecord } from '@/common/composables/use-record';
  import type { ProcessedImage, TreasurePasswordRecord, TreasureRecord } from '@shared/@types';
  import RecordEditor from '@/common/components/record-editor.vue';
  import CardEditor from '@/common/components/card-editor.vue';
  import BankCardEditor from '@/common/components/bank-card-editor.vue';
  import ConfirmationDialog from '@/common/components/dialogs/confirmation-dialog.vue';
  import { DEFAULT_GROUP, RECORD_TYPE } from '@shared/constants.ts';
  import { appTreasureDenoSrv } from '@/common/services/service-provider.ts';
  import CustomScrollBar from '@/common/components/custom-scroll-bar.vue';

  const route = useRoute();
  const router = useRouter();

  const { $openDialog } = inject(DIALOGS_KEY)!;
  const { $createNotice } = inject(NOTIFICATIONS_KEY)!;

  const recordStore = useRecordStore();
  const { records } = storeToRefs(recordStore);
  const { addRecord, updateRecord, removeRecord, addRecordToRecent } = recordStore;

  const recordId = computed(() => (route.params?.id || 'new') as string);
  const groupId = computed(() => (route.query?.groupId || '') as string);
  const isFromCardGroup = computed(() => (route.query?.cardGroup || '') === 'on');
  const isFromBankCardGroup = computed(() => (route.query?.bankCardGroup || '') === 'on');
  const isFromFavoriteGroup = computed(() => (route.query?.favoriteGroup || '') === 'on');
  const isFromRecentGroup = computed(() => (route.query?.recentGroup || '') === 'on');

  const record = recordId.value === 'new' ? undefined : records.value.find(r => r.id === recordId.value);

  const {
    t,
    isLoading,
    sortedGroups,
    recordData,
    otherRecordTypes,
    images,
    isFormValid,
    isChanged,
    switchBetweenRecordType,
  } = useRecord({
    record,
    selectedGroup: groupId.value,
  });

  function backToList() {
    const query = {
      ...(isFromCardGroup.value && { group: DEFAULT_GROUP.CARDS }),
      ...(isFromBankCardGroup.value && { group: DEFAULT_GROUP.BANK_CARDS }),
      ...(isFromFavoriteGroup.value && { group: DEFAULT_GROUP.FAVORITES }),
      ...(isFromRecentGroup.value && { group: DEFAULT_GROUP.RECENT }),
      ...(!(
        isFromCardGroup.value ||
        isFromBankCardGroup.value ||
        isFromFavoriteGroup.value ||
        isFromRecentGroup.value
      ) && {
        group: recordData.value.group,
      }),
    };

    return router.push({
      name: APP_ROUTES.RECORD_LIST,
      query,
    });
  }

  async function upsertRecord() {
    if (!isFormValid.value || !isChanged.value) {
      return;
    }

    isLoading.value = true;
    try {
      if (recordData.value.type === RECORD_TYPE.CARD) {
        recordData.value.images = [];
        for (const img of images.value) {
          const { name, data, isNew, isTouched, toDelete } = img;

          if (toDelete) {
            !isNew && (await appTreasureDenoSrv.deleteImages([name]));
            continue;
          }

          if (isNew) {
            const newImageId = await appTreasureDenoSrv.saveImage({ bytes: data as Uint8Array });
            recordData.value.images.push(newImageId);
            continue;
          }

          if (isTouched) {
            await appTreasureDenoSrv.saveImage({ id: name, bytes: data as Uint8Array });
          }

          recordData.value.images.push(name);
        }
      }

      if (recordId.value === 'new') {
        await addRecord(recordData.value);
      } else {
        await updateRecord(recordId.value, recordData.value);
        await addRecordToRecent(recordId.value);
      }

      $createNotice({
        type: 'success',
        content: t('list.notifications.success.saving', { entity: 'record' }),
      });

      await backToList();
    } catch (err) {
      console.error(
        `Error saving '${(recordData.value! as TreasurePasswordRecord).name || recordData.value!.resource}' record. `,
        err,
      );
      $createNotice({
        type: 'error',
        content: t('list.notifications.error.saving', {
          entity: 'record',
          name: (recordData.value! as TreasurePasswordRecord).name || recordData.value!.resource,
        }),
      });
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteRecord() {
    const confirmDialogRes = await $openDialog(ConfirmationDialog, {
      dialogText: t('confirmationDeleteRecordDialog.text'),
      dialogProps: {
        title: t('confirmationDeleteRecordDialog.title'),
        width: 300,
        confirmButtonText: t('confirmationDeleteRecordDialog.confirmButtonText'),
        cancelButtonText: t('confirmationDeleteRecordDialog.cancelButtonText'),
      },
    });

    const { event } = confirmDialogRes;
    if (event === 'confirm') {
      isLoading.value = true;

      try {
        await removeRecord(recordId.value);

        $createNotice({
          type: 'success',
          content: t('list.notifications.success.deleting', { entity: 'record' }),
        });

        await backToList();
      } catch (err) {
        console.error(
          `Error deleting '${(recordData.value! as TreasurePasswordRecord).name || recordData.value!.resource}' record. `,
          err,
        );
        $createNotice({
          type: 'error',
          content: t('list.notifications.error.deleting', {
            entity: 'record',
            name: (recordData.value! as TreasurePasswordRecord).name || recordData.value!.resource,
          }),
        });
      } finally {
        isLoading.value = false;
      }
    }
  }
</script>

<template>
  <div :class="$style.record">
    <div :class="$style.recordToolbar">
      <ui3n-button
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="round-arrow-back"
        icon-color="var(--color-icon-block-primary-default)"
        @click="backToList"
      />

      <span :class="$style.title">
        {{ recordId === 'new' ? t('recordDialog.title.add') : t('recordDialog.title.edit') }}
      </span>

      <span :class="$style.empty" />
    </div>

    <div :class="$style.recordBody">
      <custom-scroll-bar>
        <card-editor
          v-if="recordData.type === RECORD_TYPE.CARD"
          :record="recordData"
          :sorted-groups="sortedGroups"
          :images="images"
          mobile-mode
          @update:record="(v: TreasureRecord) => (recordData = v)"
          @update:images="(v: ProcessedImage[]) => (images = v)"
          @update:image="(v: { index: number; data: ProcessedImage }) => (images[v.index] = v.data)"
          @update:validation-flag="(v: boolean) => (isFormValid = v)"
        />

        <bank-card-editor
          v-else-if="recordData.type === RECORD_TYPE.BANK_CARD"
          :record="recordData"
          :sorted-groups="sortedGroups"
          :is-loading="isLoading"
          mobile-mode
          @update:record="(v: TreasureRecord) => (recordData = v)"
          @update:validation-flag="(v: boolean) => (isFormValid = v)"
        />

        <record-editor
          v-else
          :record="recordData"
          :records="records"
          :sorted-groups="sortedGroups"
          :is-loading="isLoading"
          @update:record="(v: TreasureRecord) => (recordData = v)"
          @update:validation-flag="(v: boolean) => (isFormValid = v)"
        />
      </custom-scroll-bar>
    </div>

    <div :class="$style.recordActions">
      <ui3n-button
        v-if="recordId !== 'new'"
        block
        type="custom"
        color="var(--color-bg-block-primary-default)"
        text-color="var(--warning-content-default)"
        icon="trash-can"
        icon-position="left"
        icon-color="var(--warning-content-default)"
        @click="deleteRecord"
      >
        {{ t('recordDialog.btn.delete') }}
      </ui3n-button>

      <div
        v-if="recordData.id === 'new'"
        :class="$style.recordTypeSwitcher"
      >
        <span>{{ t('recordDialog.btn.switch_to') }}</span>
        <template
          v-for="(rT, index) in otherRecordTypes"
          :key="rT.id"
        >
          <a
            :class="$style.recordTypesItem"
            @click.stop.prevent="() => switchBetweenRecordType(rT.id)"
          >
            {{ t(rT.name) }}
          </a>
          <span v-if="index < otherRecordTypes.length - 1">{{ t('recordDialog.text.or') }}</span>
        </template>
      </div>

      <ui3n-button
        block
        :disabled="!isFormValid || !isChanged || isLoading"
        @click="upsertRecord"
      >
        {{ recordId === 'new' ? t('recordDialog.btn.create') : t('recordDialog.btn.save') }}
      </ui3n-button>
    </div>

    <div
      v-if="isLoading"
      :class="$style.loader"
    >
      <ui3n-progress-circular
        indeterminate
        size="100"
        width="6"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .record {
    --record-toolbar-height: 48px;
    --record-actions-height: 64px;
    --record-ext-actions-height: 96px;

    position: fixed;
    inset: 0;
    background-color: var(--color-bg-block-primary-default);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;

    .recordToolbar {
      display: flex;
      width: 100%;
      height: var(--record-toolbar-height);
      min-height: var(--record-toolbar-height);
      max-height: var(--record-toolbar-height);
      justify-content: space-between;
      align-items: center;
      padding: 0 var(--spacing-m) 0 var(--spacing-s);
      border-bottom: 1px solid var(--color-border-block-primary-default);

      .title {
        font-size: var(--font-16);
        font-weight: 700;
        line-height: 1;
        color: var(--color-text-block-primary-default);
      }

      .empty {
        display: block;
        position: relative;
        width: var(--spacing-l);
      }
    }

    .recordBody {
      position: relative;
      width: 100%;
      flex-grow: 1;
    }

    .recordActions {
      display: flex;
      flex-direction: column;
      min-height: var(--record-actions-height);
      padding: var(--spacing-m);
      justify-content: flex-start;
      align-items: center;
      row-gap: 6px;

      .recordTypeSwitcher {
        display: flex;
        flex-direction: row;
        width: 100%;
        padding: var(--spacing-xs) 0;
        justify-content: center;
        align-items: center;
        column-gap: var(--spacing-xs);
        font-size: var(--font-14);
        font-weight: 500;
        line-height: var(--font-18);
        color: var(--color-text-control-primary-default);

        .recordTypesItem {
          color: var(--color-text-control-secondary-default);
          cursor: pointer;

          &:hover {
            color: var(--color-text-control-accent-default);
          }
        }
      }

      button {
        padding-right: var(--spacing-m);
        padding-left: var(--spacing-m);
      }
    }

    .loader {
      position: absolute;
      left: 0;
      width: 100%;
      top: var(--record-toolbar-height);
      bottom: var(--record-actions-height);
      z-index: 1;
      pointer-events: none;
      display: flex;
      justify-content: center;
      align-items: center;
    }
  }
</style>
