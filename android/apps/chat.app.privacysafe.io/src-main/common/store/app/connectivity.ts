/*
Copyright (C) 2024 - 2025 3NSoft Inc.

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

import { toRO } from "@main/common/utils/readonly.ts";
import { ref } from "vue";
import { ConnectivityStatus } from "~/app.types.ts";

export function useConnectivityStatus() {

  const connectivityStatus = ref<string>('offline');

  async function fetchConnectivityStatus() {
    const status = await w3n.connectivity!.isOnline();
    if (status) {
      const parsedStatus = status.split('_');
      connectivityStatus.value = parsedStatus[0] as ConnectivityStatus;
    }
  }

  const connectivityTimerId = ref<ReturnType<typeof setInterval>>();

  async function initialize() {
    await fetchConnectivityStatus();
    connectivityTimerId.value = setInterval(fetchConnectivityStatus, 60000);
  }

  function stopConnectivityCheck() {
    connectivityTimerId.value && clearInterval(connectivityTimerId.value!);
  }

  return {
    connectivityStatus: toRO(connectivityStatus),

    fetchConnectivityStatus,
    initialize,
    stopConnectivityCheck
  };
}
