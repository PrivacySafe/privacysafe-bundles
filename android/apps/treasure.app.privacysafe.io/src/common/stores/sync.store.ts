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
import { defineStore } from 'pinia';
import type { SyncType } from '@shared/@types';

export const useSyncStore = defineStore('sync', () => {
  const syncProcesses = ref<Record<string, { type: SyncType; value: number }>>({});

  const isSyncRunning = computed(() => Object.keys(syncProcesses.value).length > 0);

  function addRecordToSyncList(id: string, type: SyncType) {
    syncProcesses.value[id] = { type, value: 0 };
  }

  function removeRecordFromSyncList(id: string) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete syncProcesses.value[id];
  }

  function updateSyncListRecord(id: string, type: SyncType, value: number) {
    syncProcesses.value[id] = { type, value };
  }

  return {
    syncProcesses,
    isSyncRunning,
    addRecordToSyncList,
    removeRecordFromSyncList,
    updateSyncListRecord,
  };
});
