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
  import { computed, inject, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import {
    DIALOGS_KEY,
    type DialogsPlugin,
    NOTIFICATIONS_KEY,
    type NotificationsPlugin,
  } from '@v1nt1248/3nclient-lib/plugins';
  import { useSort } from '@/common/composables/use-sort';
  import type { TreasureGroup, TreasurePasswordRecord, TreasureRecord } from '@shared/@types';
  import { useRecordStore } from '@/common/stores/record.store';
  import { prepareRecordList } from '@/common/utils';
  import EditRecordDialog from '@/desktop/components/edit-record-dialog.vue';
  import EditGroupDialog from '@/desktop/components/edit-group-dialog.vue';
  import TreasureGroups from '@/desktop/components/groups.vue';
  import TreasureToolbar from '@/desktop/components/toolbar.vue';
  import TreasuresTable from '@/desktop/components/treasures-table/treasures-table.vue';

  const { sortTreasuresTableData, sortTreasuresRecentData } = useSort();

  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const recordStore = useRecordStore();
  const { sortedGroups, records, recordsByGroups, numOfRecentRecords } = storeToRefs(recordStore);
  const { upsertGroup, deleteGroup, updateRecordList, addRecord, updateRecord, removeRecord, addRecordToRecent } =
    recordStore;

  const searchText = ref('');
  const selectedGroup = ref('');

  const processedSearchText = computed(() => searchText.value.toLowerCase());

  const filteredRecords = computed(() => {
    if (!selectedGroup.value) {
      return prepareRecordList(records.value, processedSearchText.value);
    } else if (selectedGroup.value == 'recent') {
      return prepareRecordList(
        recordsByGroups.value[selectedGroup.value],
        processedSearchText.value,
        sortTreasuresRecentData,
      );
    }
    return prepareRecordList(
      recordsByGroups.value[selectedGroup.value],
      processedSearchText.value,
      sortTreasuresTableData,
    );
  });

  function selectGroup(gr: string) {
    if (selectedGroup.value !== gr) {
      selectedGroup.value = gr;
    }
  }

  async function upsertRecord(data: TreasureRecord) {
    try {
      if (data.id === 'new') {
        await addRecord(data);
      } else {
        await updateRecord(data.id, data);
      }

      $createNotice({
        type: 'success',
        content: t('list.notifications.success.saving'),
      });
    } catch (err) {
      console.error(`Error saving '${(data as TreasurePasswordRecord)!.name || data!.resource}' record. `, err);
      $createNotice({
        type: 'error',
        content: t('list.notifications.error.saving', {
          entity: 'record',
          name: (data as TreasurePasswordRecord)!.name || data!.resource,
        }),
      });
    }
  }

  async function deleteRecord(data: TreasureRecord) {
    try {
      await removeRecord(data.id);
    } catch (err) {
      console.error(`Error deleting '${(data as TreasurePasswordRecord)!.name || data!.resource}' record. `, err);
      $createNotice({
        type: 'error',
        content: t('list.notifications.error.deleting', {
          entity: 'record',
          name: (data as TreasurePasswordRecord)!.name || data!.resource,
        }),
      });
    }
  }

  async function openEditRecordDialog(recordId?: string) {
    const record = recordId ? records.value.find(r => r.id === recordId) : null;
    if (record) {
      addRecordToRecent(record.id);
    }

    const recordDialogRes = await dialog.$openDialog<TreasureRecord, 'delete'>(EditRecordDialog, {
      ...(record && { record }),
      ...(!record && { selectedGroup: selectedGroup.value }),
      dialogProps: {
        width: 580,
        title: '',
        confirmButton: false,
        cancelButton: false,
      },
    });

    const { event, data } = recordDialogRes;
    switch (event) {
      case 'confirm': {
        await upsertRecord(data!);
        break;
      }

      case 'delete': {
        await deleteRecord(data!);
        break;
      }

      // no default
    }
  }

  async function updateGroupData(data: TreasureGroup) {
    try {
      await upsertGroup(data!);
    } catch (err) {
      console.error(`Error saving '${data!.name}' group. `, err);
      $createNotice({
        type: 'error',
        content: t('list.notifications.error.saving', { entity: 'group', name: data!.name }),
      });
    }
  }

  async function deleteGr(group: TreasureGroup) {
    try {
      await deleteGroup(group.id);
    } catch (err) {
      console.error(`Error deleting '${group!.name}' group. `, err);
      $createNotice({
        type: 'error',
        content: t('list.notifications.error.deleting', { entity: 'group', name: group!.name }),
      });
    }
  }

  async function openEditGroupDialog(groupId?: string) {
    const group = groupId ? sortedGroups.value.find(gr => gr.id === groupId) : null;
    const groupDialogRes = await dialog.$openDialog<TreasureGroup, 'delete'>(EditGroupDialog, {
      ...(group && { group }),
      dialogProps: {
        title: '',
        confirmButton: false,
        cancelButton: false,
      },
    });

    const { event, data } = groupDialogRes;
    switch (event) {
      case 'confirm': {
        await updateGroupData(data!);
        break;
      }

      case 'delete': {
        if (selectedGroup.value === data?.id) {
          selectGroup('');
        }
        await deleteGr(data!);
        break;
      }

      // no default
    }
  }

  async function setFavorite(record: TreasureRecord) {
    const isFavorite = !record.isFavorite;
    const updatedRecord = {
      ...record,
      isFavorite,
    };
    updateRecordList(updatedRecord);
    await updateRecord(record.id, updatedRecord);
  }

  const setInitialGroupToRecent = computed(() => numOfRecentRecords.value > 0);

  const stopWatchingGroups = watch(setInitialGroupToRecent, doSetRecent => {
    doSetRecent ? (selectedGroup.value = 'recent') : (selectedGroup.value = '');
    stopWatchingGroups();
  });
</script>

<template>
  <section :class="$style.recordList">
    <aside>
      <treasure-groups
        :groups="sortedGroups"
        :selected-group="selectedGroup"
        @create:treasure="openEditRecordDialog"
        @select="selectGroup"
        @edit:group="(id: string) => openEditGroupDialog(id)"
      />
    </aside>

    <header>
      <treasure-toolbar
        v-model="searchText"
        @create:group="() => openEditGroupDialog()"
      />
    </header>
    <main>
      <treasures-table
        :selected-group="selectedGroup"
        :records="filteredRecords"
        @edit="(r: TreasureRecord) => openEditRecordDialog(r.id)"
        @set:favorite="setFavorite"
      />
    </main>
  </section>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .recordList {
    --record-list-side-menu-width: 190px;
    --record-list-toolbar-height: 64px;

    position: relative;
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-columns: var(--record-list-side-menu-width) 1fr;
    grid-template-rows: var(--record-list-toolbar-height) 1fr;
    grid-template-areas:
      'list toolbar'
      'list main';
  }

  aside {
    grid-area: list;
    position: relative;
    width: 100%;
    height: 100%;
    border-right: 1px solid var(--color-border-block-primary-default);
  }

  header {
    grid-area: toolbar;
    display: flex;
    width: 100%;
    height: 100%;
    border-bottom: 1px solid var(--color-border-block-primary-default);
    justify-content: space-between;
    align-items: center;
  }

  main {
    grid-area: main;
    position: relative;
    width: 100%;
    height: calc(100% - 8px);
    overflow-y: auto;
    scrollbar-gutter: stable;
  }
</style>
