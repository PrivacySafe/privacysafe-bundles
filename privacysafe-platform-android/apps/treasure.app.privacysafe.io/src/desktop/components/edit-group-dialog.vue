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
  import { DIALOGS_KEY, NOTIFICATIONS_KEY } from '@v1nt1248/3nclient-lib/plugins';
  import {
    Ui3nButton,
    Ui3nDialog,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
    Ui3nIcon,
    Ui3nInput,
    Ui3nText,
  } from '@v1nt1248/3nclient-lib';
  import { useGroup } from '@/common/composables/use-group';
  import { removeWhitespaceInString } from '@shared/utils/remove-whitespace-in-string';
  import type { TreasureGroup } from '@shared/@types';
  import ConfirmationDialog from '@/common/components/dialogs/confirmation-dialog.vue';

  const newGroupData: TreasureGroup = {
    id: '',
    name: '',
    description: '',
  };

  const props = defineProps<{
    group?: TreasureGroup;
    dialogProps?: Ui3nDialogComponentProps<TreasureGroup>;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent | 'delete'; data?: TreasureGroup }): void;
  }>();

  const { $openDialog } = inject(DIALOGS_KEY)!;
  const { $createNotice } = inject(NOTIFICATIONS_KEY)!;

  const { t, groupData, isFormValid, recordsInGroup, isChanged, nameRules, handleInput, onValidationFlagUpdate } =
    useGroup(props.group || newGroupData);

  async function deleteGroup() {
    if (recordsInGroup.value > 0) {
      $createNotice({
        type: 'warning',
        content: t('list.notifications.warning.delete'),
        duration: 4000,
      });
      return;
    }

    const confirmDialogRes = await $openDialog(ConfirmationDialog, {
      dialogText: t('confirmationDeleteGroupDialog.text'),
      dialogProps: {
        title: t('confirmationDeleteGroupDialog.title'),
        width: 300,
        confirmButtonText: t('confirmationDeleteGroupDialog.confirmButtonText'),
        cancelButtonText: t('confirmationDeleteGroupDialog.cancelButtonText'),
      },
    });

    const { event } = confirmDialogRes;
    if (event === 'confirm') {
      emits('action', { event: 'delete', data: props.group! });
    }
  }

  function handleCancel() {
    emits('action', { event: 'cancel' });
  }

  async function handleOk() {
    if (!isFormValid.value || !isChanged.value) {
      return;
    }

    if (!groupData.value.id) {
      groupData.value.id = removeWhitespaceInString(groupData.value.name).toLowerCase();
    }

    emits('action', { event: 'confirm', data: groupData.value });
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :class="$style.editGroupDialog"
    @action="emits('action', $event)"
  >
    <template #header>
      <div :class="$style.header">
        <div :class="$style.block">
          <ui3n-icon
            :icon="groupData.id ? 'key-vertical-outline' : 'round-plus'"
            size="14"
            color="var(--info-outline-default)"
          />

          <span :class="$style.title">
            {{ groupData.id ? t('groupDialog.title.edit') : t('groupDialog.title.add') }}
          </span>
        </div>
      </div>
    </template>

    <template #body>
      <div :class="$style.body">
        <div :class="$style.row">
          <ui3n-input
            :model-value="groupData.name"
            :label="`${t('groupDialog.form.fields.name.label')}*`"
            :placeholder="t('groupDialog.form.fields.name.placeholder')"
            :rules="nameRules"
            :disabled="!!groupData.id"
            @update:model-value="v => handleInput('name', v)"
            @update:valid="onValidationFlagUpdate"
          />
        </div>

        <div :class="$style.row">
          <ui3n-text
            :model-value="groupData.description || ''"
            :label="t('groupDialog.form.fields.description.label')"
            :placeholder="t('groupDialog.form.fields.description.placeholder')"
            @update:model-value="v => handleInput('description', v)"
          />
        </div>
      </div>
    </template>

    <template #actions>
      <div :class="$style.actions">
        <div :class="$style.block">
          <ui3n-button
            v-if="groupData.id"
            type="custom"
            color="var(--color-bg-block-primary-default)"
            text-color="var(--warning-content-default)"
            icon="trash-can"
            icon-position="left"
            icon-color="var(--warning-content-default)"
            @click.stop.prevent="deleteGroup"
          >
            {{ t('groupDialog.btn.delete') }}
          </ui3n-button>
        </div>

        <div :class="$style.block">
          <ui3n-button
            type="secondary"
            @click.stop.prevent="handleCancel"
          >
            {{ t('groupDialog.btn.close') }}
          </ui3n-button>

          <ui3n-button
            :disabled="!isFormValid || !isChanged"
            @click.stop.prevent="handleOk"
          >
            {{ groupData.id ? t('groupDialog.btn.save') : t('groupDialog.btn.create') }}
          </ui3n-button>
        </div>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  @use '@/assets/styles/mixins' as mixins;

  .editGroupDialog {
    --group-dialog-header-height: 48px;
    --group-dialog-actions-height: 64px;

    position: relative;
    width: 400px !important;
    border-radius: var(--spacing-m) !important;

    .block {
      display: flex;
      justify-content: center;
      align-items: center;
      column-gap: var(--spacing-xs);
    }

    .header {
      display: flex;
      width: 100%;
      height: var(--group-dialog-header-height);
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

    .body {
      position: relative;
      width: 100%;
      height: 320px;
      padding: var(--spacing-m);

      .row {
        position: relative;
        width: 100%;
        margin-bottom: var(--spacing-s);
      }
    }

    .actions {
      display: flex;
      width: 100%;
      height: var(--group-dialog-actions-height);
      padding: 0 var(--spacing-m);
      justify-content: space-between;
      align-items: center;
    }
  }
</style>
