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
  import { Ui3nButton, Ui3nInput, Ui3nProgressCircular, Ui3nText } from '@v1nt1248/3nclient-lib';
  import { APP_ROUTES } from '@/common/constants';
  import { useRecordStore } from '@/common/stores/record.store';
  import { useGroup } from '@/common/composables/use-group';
  import { removeWhitespaceInString } from '@shared/utils/remove-whitespace-in-string.ts';
  import ConfirmationDialog from '@/common/components/dialogs/confirmation-dialog.vue';

  const route = useRoute();
  const router = useRouter();

  const { $openDialog } = inject(DIALOGS_KEY)!;
  const { $createNotice } = inject(NOTIFICATIONS_KEY)!;

  const recordStore = useRecordStore();
  const { sortedGroups } = storeToRefs(recordStore);
  const { upsertGroup: _upsertGroup, deleteGroup: _deleteGroup } = recordStore;

  const groupId = computed(() => (route.params?.id as string) || '');

  const group = groupId.value ? sortedGroups.value.find(gr => gr.id === groupId.value) : undefined;

  const {
    t,
    isLoading,
    groupData,
    isFormValid,
    isChanged,
    recordsInGroup,
    nameRules,
    handleInput,
    onValidationFlagUpdate,
  } = useGroup(group);

  function backToList(all?: boolean) {
    return router.push({
      name: APP_ROUTES.RECORD_LIST,
      ...((all || groupId.value) && { query: { group: all ? '' : groupId.value } }),
    });
  }

  async function upsertGroup() {
    isLoading.value = true;
    try {
      if (!groupData.value.id) {
        groupData.value.id = removeWhitespaceInString(groupData.value.name).toLowerCase();
      }

      await _upsertGroup(groupData.value);
      $createNotice({
        type: 'success',
        content: t('list.notifications.success.saving', { entity: 'group' }),
      });
      await backToList();
    } catch (err) {
      console.error(`Error saving '${groupData.value!.name}' group. `, err);
      $createNotice({
        type: 'error',
        content: t('list.notifications.error.saving', { entity: 'group', name: groupData.value!.name }),
      });
    } finally {
      isLoading.value = false;
    }
  }

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
      isLoading.value = true;
      try {
        await _deleteGroup(groupId.value);

        $createNotice({
          type: 'success',
          content: t('list.notifications.success.deleting', { entity: 'group' }),
        });

        await backToList(true);
      } catch (err) {
        console.error(`Error deleting '${groupData.value!.name}' group. `, err);
        $createNotice({
          type: 'error',
          content: t('list.notifications.error.deleting', { entity: 'group', name: groupData.value!.name }),
        });
      } finally {
        isLoading.value = false;
      }
    }
  }
</script>

<template>
  <div :class="[$style.group, groupId && $style.deletable]">
    <div :class="$style.toolbar">
      <ui3n-button
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="round-arrow-back"
        icon-color="var(--color-icon-block-primary-default)"
        @click="() => backToList()"
      />

      <span :class="$style.title">
        {{ groupId ? t('groupDialog.title.edit') : t('groupDialog.title.add') }}
      </span>

      <span :class="$style.empty" />
    </div>

    <div :class="[$style.body, isLoading && $style.blurry]">
      <div :class="$style.row">
        <ui3n-input
          :model-value="groupData.name"
          :label="`${t('groupDialog.form.fields.name.label')}*`"
          :placeholder="t('groupDialog.form.fields.name.placeholder')"
          :rules="nameRules"
          :disabled="!!groupData.id"
          @update:model-value="(v: string) => handleInput('name', v)"
          @update:valid="onValidationFlagUpdate"
        />
      </div>

      <div :class="$style.row">
        <ui3n-text
          :model-value="groupData.description || ''"
          :label="t('groupDialog.form.fields.description.label')"
          :placeholder="t('groupDialog.form.fields.description.placeholder')"
          @update:model-value="(v: string) => handleInput('description', v)"
        />
      </div>
    </div>

    <div :class="$style.actions">
      <ui3n-button
        v-if="groupId"
        size="large"
        block
        type="custom"
        color="var(--color-bg-block-primary-default)"
        text-color="var(--warning-content-default)"
        icon="trash-can"
        icon-position="left"
        icon-color="var(--warning-content-default)"
        @click="deleteGroup"
      >
        {{ t('groupDialog.btn.delete') }}
      </ui3n-button>

      <ui3n-button
        size="large"
        block
        :disabled="!isFormValid || !isChanged || isLoading"
        @click="upsertGroup"
      >
        {{ groupId ? t('groupDialog.btn.save') : t('groupDialog.btn.create') }}
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
  .group {
    --group-toolbar-height: 48px;
    --group-actions-height: 64px;
    --group-ext-actions-height: 120px;

    position: fixed;
    inset: 0;
    background-color: var(--color-bg-block-primary-default);
    overflow: hidden;

    .toolbar {
      display: flex;
      width: 100%;
      height: var(--group-toolbar-height);
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

    .body {
      position: relative;
      width: 100%;
      height: calc(100% - var(--group-toolbar-height) - var(--group-actions-height) - var(--spacing-xs));
      padding: var(--spacing-m) var(--spacing-m) 0 var(--spacing-m);
      overflow-x: hidden;
      overflow-y: auto;

      &.blurry {
        filter: blur(2px);
      }

      .row {
        position: relative;
        width: 100%;
        margin-bottom: var(--spacing-s);
      }
    }

    .actions {
      display: flex;
      width: 100%;
      height: var(--group-actions-height);
      padding: 0 var(--spacing-m);
      justify-content: stretch;
      align-items: center;
    }

    &.deletable {
      .body {
        height: calc(100% - var(--group-toolbar-height) - var(--group-ext-actions-height) - var(--spacing-xs));
      }

      .actions {
        height: var(--group-ext-actions-height);
        flex-direction: column;
        justify-content: center;
        align-items: stretch;
        row-gap: var(--spacing-s);
      }
    }

    .loader {
      position: absolute;
      left: 0;
      width: 100%;
      top: var(--group-toolbar-height);
      bottom: var(--group-actions-height);
      z-index: 1;
      pointer-events: none;
      display: flex;
      justify-content: center;
      align-items: center;
    }
  }
</style>
