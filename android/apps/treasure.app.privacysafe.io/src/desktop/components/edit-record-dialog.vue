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
  import { inject } from 'vue';
  import { storeToRefs } from 'pinia';
  import cloneDeep from 'lodash/cloneDeep';
  import { DIALOGS_KEY, NOTIFICATIONS_KEY } from '@v1nt1248/3nclient-lib/plugins';
  import {
    Ui3nButton,
    Ui3nDialog,
    Ui3nIcon,
    Ui3nProgressCircular,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
  } from '@v1nt1248/3nclient-lib';
  import { RECORD_TYPE } from '@shared/constants';
  import { appTreasureDenoSrv } from '@/common/services/service-provider';
  import { useRecordStore } from '@/common/stores/record.store';
  import { useRecord } from '@/common/composables/use-record';
  import type { ProcessedImage, TreasurePasswordRecord, TreasureRecord } from '@shared/@types';
  import ConfirmationDialog from '@/common/components/dialogs/confirmation-dialog.vue';
  import RecordEditor from '@/common/components/record-editor.vue';
  import CardEditor from '@/common/components/card-editor.vue';
  import BankCardEditor from '@/common/components/bank-card-editor.vue';

  const props = defineProps<{
    record?: TreasureRecord;
    selectedGroup?: string;
    dialogProps?: Ui3nDialogComponentProps<TreasureRecord>;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent | 'delete'; data?: TreasureRecord }): void;
  }>();

  const { $openDialog } = inject(DIALOGS_KEY)!;
  const { $createNotice } = inject(NOTIFICATIONS_KEY)!;
  const { sortedGroups, records } = storeToRefs(useRecordStore());

  const {
    t,
    isLoading,
    dialogTitle,
    recordData,
    otherRecordTypes,
    images,
    isFormValid,
    isChanged,
    switchBetweenRecordType,
  } = useRecord({ record: cloneDeep(props.record), selectedGroup: props.selectedGroup });

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
      emits('action', { event: 'delete', data: props.record! });
    }
  }

  function handleCancel() {
    emits('action', { event: 'cancel' });
  }

  async function handleOk() {
    if (!isFormValid.value || !isChanged.value) {
      return;
    }

    try {
      isLoading.value = true;
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

      emits('action', { event: 'confirm', data: recordData.value });
    } catch (err) {
      console.error('Error updating images of the custom user card. ', err);
      $createNotice({
        type: 'error',
        content: 'Something went wrong. Error updating images of the custom user card.',
      });
    } finally {
      isLoading.value = false;
    }
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :class="$style.editRecordDialog"
    @action="emits('action', $event)"
  >
    <template #header>
      <div :class="$style.header">
        <div :class="$style.block">
          <ui3n-icon
            :icon="recordData.id === 'new' ? 'round-plus' : 'key-vertical-outline'"
            size="14"
            color="var(--info-outline-default)"
          />

          <span :class="$style.title">
            {{ dialogTitle }}
          </span>
        </div>
      </div>
    </template>

    <template #body>
      <card-editor
        v-if="recordData.type === RECORD_TYPE.CARD"
        :record="recordData"
        :records="records"
        :sorted-groups="sortedGroups"
        :images="images"
        :is-loading="isLoading"
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
        :record="recordData as TreasurePasswordRecord"
        :records="records"
        :sorted-groups="sortedGroups"
        :is-loading="isLoading"
        @update:record="(v: TreasureRecord) => (recordData = v)"
        @update:validation-flag="(v: boolean) => (isFormValid = v)"
      />

      <div
        v-if="isLoading"
        :class="$style.loader"
      >
        <ui3n-progress-circular
          indeterminate
          size="100"
        />
      </div>
    </template>

    <template #actions>
      <div :class="$style.actions">
        <div :class="$style.block">
          <ui3n-button
            v-if="recordData.id !== 'new'"
            type="custom"
            color="var(--color-bg-block-primary-default)"
            text-color="var(--warning-content-default)"
            icon="trash-can"
            icon-position="left"
            icon-color="var(--warning-content-default)"
            @click.stop.prevent="deleteRecord"
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
        </div>

        <div :class="$style.block">
          <ui3n-button
            type="secondary"
            @click.stop.prevent="handleCancel"
          >
            {{ recordData.id === 'new' ? t('recordDialog.btn.close') : t('recordDialog.btn.discard') }}
          </ui3n-button>

          <ui3n-button
            :disabled="!isFormValid || !isChanged"
            @click.stop.prevent="handleOk"
          >
            {{ recordData.id === 'new' ? t('recordDialog.btn.create') : t('recordDialog.btn.save') }}
          </ui3n-button>
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  @use '@/assets/styles/mixins' as mixins;

  .editRecordDialog {
    --record-dialog-header-height: 48px;
    --record-dialog-actions-height: 64px;

    position: relative;
    border-radius: var(--spacing-m) !important;
    overflow: hidden;

    .block {
      display: flex;
      justify-content: center;
      align-items: center;
      column-gap: var(--spacing-xs);
    }

    .header {
      display: flex;
      width: 100%;
      height: var(--record-dialog-header-height);
      padding: 0 var(--spacing-m);
      justify-content: space-between;
      align-items: center;
      column-gap: var(--spacing-m);
      border-bottom: 1px solid var(--color-border-block-primary-default);

      .title {
        font-size: var(--font-12);
        font-weight: 600;
        color: var(--color-text-block-primary-default);
      }
    }

    .actions {
      display: flex;
      width: 100%;
      height: var(--record-dialog-actions-height);
      padding: 0 var(--spacing-m);
      justify-content: space-between;
      align-items: center;
    }

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

    & > div:nth-child(2) {
      overflow: hidden !important;
    }

    .loader {
      position: absolute;
      inset: 0;
      display: flex;
      justify-content: center;
      align-items: center;
    }
  }
</style>
