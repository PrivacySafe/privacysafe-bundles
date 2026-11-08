/*
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
*/
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { defineStore } from 'pinia';
import cloneDeep from 'lodash/cloneDeep';
import size from 'lodash/size';
import keyBy from 'lodash/keyBy';
import { appTreasureDenoSrv } from '@/common/services/service-provider';
import { useAppStore } from '@/common/stores/app.store';
import type { TreasureGroup, TreasureRecord } from '@shared/@types';
import { DEFAULT_GROUP, RECORD_TYPE } from '@shared/constants.ts';

const MAX_RECENT_LIST_SIZE = 20;

export const useRecordStore = defineStore('records', () => {
  const { t } = useI18n();
  const { setCommonLoading } = useAppStore();

  const idsOfRecentRecords = ref<string[]>([]);

  const records = ref<TreasureRecord[]>([]);
  const groups = ref<Record<string, TreasureGroup>>({});

  const allGroupsNames = computed(() => Object.values(groups.value).map(gr => gr.name));

  const sortedGroups = computed(() =>
    Object.values(groups.value).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
  );

  const sortedGroupsAll = computed(() => [
    { id: 'all', name: t('list.all') },
    { id: DEFAULT_GROUP.RECENT, name: t('list.recent') },
    { id: DEFAULT_GROUP.CARDS, name: t('list.cards') },
    { id: DEFAULT_GROUP.BANK_CARDS, name: t('list.bank_cards') },
    { id: DEFAULT_GROUP.FAVORITES, name: t('list.favorites') },
    ...sortedGroups.value,
  ]);

  const recentRecords = computed(() => records.value.filter(r => idsOfRecentRecords.value.includes(r.id)));
  const favoritesRecords = computed(() => records.value.filter(r => r.isFavorite));
  const cardsRecords = computed(() => records.value.filter(r => r.type === RECORD_TYPE.CARD));
  const bankCardsRecords = computed(() => records.value.filter(r => r.type === RECORD_TYPE.BANK_CARD));
  const numOfRecentRecords = computed(() => recentRecords.value.length);
  const sortedRecentRecords = computed(() =>
    idsOfRecentRecords.value.map(id => records.value.find(item => item.id === id)),
  );

  const recordsByGroups = computed(() =>
    records.value.reduce(
      (res, r) => {
        const { group } = r;
        if (!group) {
          return res;
        }

        if (!res[group]) {
          res[group] = [];
        }
        res[group].push(r);

        return res;
      },
      {
        [DEFAULT_GROUP.RECENT]: sortedRecentRecords.value,
        [DEFAULT_GROUP.FAVORITES]: favoritesRecords.value,
        [DEFAULT_GROUP.CARDS]: cardsRecords.value,
        [DEFAULT_GROUP.BANK_CARDS]: bankCardsRecords.value,
      } as Record<string, TreasureRecord[]>,
    ),
  );

  async function upsertGroup(group: TreasureGroup) {
    const updatedGroupsData = cloneDeep(groups.value);
    updatedGroupsData[group.id] = group;
    const wasSync = await appTreasureDenoSrv.rewriteGroups(Object.values(updatedGroupsData));
    groups.value[group.id] = {
      ...group,
      withoutSync: !wasSync,
    };
  }

  async function deleteGroup(groupId: string): Promise<boolean> {
    if (size(recordsByGroups.value[groupId])) {
      return false;
    }

    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete groups.value[groupId];
    await appTreasureDenoSrv.rewriteGroups(Object.values(groups.value));
    return true;
  }

  function getGroup(groupId: string): TreasureGroup | undefined {
    return groups.value[groupId];
  }

  async function getAllGroups() {
    const res = await appTreasureDenoSrv.getAllTreasureGroups();
    groups.value = res ? keyBy(res, 'id') : {};
  }

  function updateRecordList(record: TreasureRecord, removing?: boolean) {
    const index = records.value.findIndex(r => r.id === record.id);
    if (index >= 0) {
      removing && records.value.splice(index, 1);
      !removing && (records.value[index] = record);
    } else {
      !removing && records.value.push(record);
    }
  }

  async function getRecordSyncStatus(id: string): Promise<web3n.files.SyncStatus | undefined> {
    return appTreasureDenoSrv.getRecordSyncStatus(id);
  }

  async function addRecord(data: TreasureRecord): Promise<void> {
    if (data.id !== 'new') {
      throw new Error(
        `It's not possible to add a record with ID other then 'new'. The current record has ID '${data.id}'.`,
      );
    }

    const actionResult = await appTreasureDenoSrv.addRecord(data);
    if (actionResult) {
      records.value.push({
        ...data,
        id: actionResult.id,
        withoutSync: !actionResult.wasSync,
      });
    }
  }

  async function removeRecord(id: string): Promise<void> {
    const index = records.value.findIndex(r => r.id === id);
    let record: TreasureRecord | null = null;
    if (index >= 0) {
      record = records.value.splice(index, 1)[0];
    }

    if (record) {
      await appTreasureDenoSrv.deleteRecord(record);
      await removeRecordFromRecent(id);
    }
  }

  async function updateRecord(id: string, data: Partial<TreasureRecord>): Promise<void> {
    const index = records.value.findIndex(r => r.id === data.id);
    if (index === -1) {
      console.error(`There is no record with ID '${id}'`);
      return;
    }

    const record = cloneDeep(records.value[index]);
    const updatedRecord = {
      ...record,
      ...data,
    } as TreasureRecord;

    const wasSync = await appTreasureDenoSrv.updateRecord(updatedRecord);
    records.value[index] = {
      ...updatedRecord,
      withoutSync: !wasSync,
    };
  }

  async function getAllRecords() {
    const res = await appTreasureDenoSrv.getAllRecords();
    records.value = res.records;
  }

  async function getRecord(recordId: string) {
    const record = await appTreasureDenoSrv.getRecord(recordId);
    if (record) {
      updateRecordList(record);
    }
  }

  async function getRecords(recordIds: string[]) {
    try {
      setCommonLoading(true);
      for (const recordId of recordIds) {
        await getRecord(recordId);
      }
    } finally {
      setCommonLoading(false);
    }
  }

  async function loadRecentRecords() {
    idsOfRecentRecords.value = await appTreasureDenoSrv.loadRecentFile();
  }

  function saveRecentRecords() {
    return appTreasureDenoSrv.saveRecentFile(idsOfRecentRecords.value || []);
  }

  async function addRecordToRecent(recordId: string) {
    const index = idsOfRecentRecords.value.findIndex(rId => rId === recordId);
    if (index === -1) {
      if (size(idsOfRecentRecords.value) >= MAX_RECENT_LIST_SIZE) {
        idsOfRecentRecords.value.shift();
      }
      idsOfRecentRecords.value.push(recordId);
    } else {
      const tmp = cloneDeep(idsOfRecentRecords.value);
      tmp.splice(index, 1);
      tmp.push(recordId);
      idsOfRecentRecords.value = tmp;
    }

    await saveRecentRecords();
  }

  async function removeRecordFromRecent(recordId: string) {
    const index = idsOfRecentRecords.value.findIndex(rId => rId === recordId);
    if (index >= 0) {
      idsOfRecentRecords.value.splice(index, 1);
      await saveRecentRecords();
    }
  }

  async function $reset() {
    idsOfRecentRecords.value = [];
    await saveRecentRecords();
  }

  return {
    groups,
    sortedGroups,
    sortedGroupsAll,
    allGroupsNames,

    records,
    favoritesRecords,
    recordsByGroups,

    upsertGroup,
    deleteGroup,
    getGroup,
    getAllGroups,

    getRecordSyncStatus,
    updateRecordList,
    getRecord,
    getRecords,
    addRecord,
    removeRecord,
    updateRecord,
    getAllRecords,
    numOfRecentRecords,

    loadRecentRecords,
    saveRecentRecords,
    addRecordToRecent,
    removeRecordFromRecent,
    $reset,
  };
});
