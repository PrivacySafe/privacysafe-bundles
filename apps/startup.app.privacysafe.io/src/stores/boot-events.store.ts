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
import { ref } from 'vue';
import { defineStore } from 'pinia';

export const useBootEventsStore = defineStore('boot-events', () => {
  const eventsLog = ref<web3n.startup.BootEvent[]>([]);
  const bootDone = ref(false);

  function startWatchBoot() {
    w3n.signIn.watchBoot({
      next: ev => {
        console.log('[##] SIGN_IN WATCH NEXT => ', ev);
        eventsLog.value.push(ev);
      },
      error: err => {
        console.log('[##] SIGN_IN WATCH ERROR => ', err);
      },
      complete: () => {
        console.log('[##] SIGN_IN WATCH COMPLETE [##]');
        bootDone.value = true;
      },
    });
  }

  return {
    eventsLog,
    bootDone,
    startWatchBoot,
  };
});
