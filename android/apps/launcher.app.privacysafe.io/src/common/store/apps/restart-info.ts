/*
 Copyright (C) 2024 - 2025 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

 This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with this program. If not, see <http://www.gnu.org/licenses/>.
*/
import { ref } from 'vue';

export function makeRestartInfoPlace() {
  const restart = ref<{ apps?: string[]; platform?: true } | null>(null);

  function setAppsRestart(ids: string[] | undefined): void {
    if (ids && ids.length > 0) {
      if (!restart.value) {
        restart.value = {};
      }
      restart.value.apps = ids;
    } else if (restart.value) {
      if (restart.value.platform) {
        delete restart.value.apps;
      } else {
        restart.value = null;
      }
    }
  }

  function setPlatformRestart(flag: boolean): void {
    if (flag) {
      if (!restart.value) {
        restart.value = {};
      }
      restart.value.platform = true;
    } else if (restart.value) {
      if (restart.value.apps) {
        delete restart.value.platform;
      } else {
        restart.value = null;
      }
    }
  }

  return {
    restart,

    setAppsRestart,
    setPlatformRestart,
  };
}

export type RestartInfo = ReturnType<typeof makeRestartInfoPlace>;
