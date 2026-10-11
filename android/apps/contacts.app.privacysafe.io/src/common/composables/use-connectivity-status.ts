/*
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
*/
import { ref } from 'vue';
import { ConnectivityStatus } from '@main/types';

export function useConnectivityStatus() {
  const connectivityStatus = ref<ConnectivityStatus>('offline');

  w3n.connectivity?.watch({
    next: value => {
      const { isOnline } = value;
      connectivityStatus.value = isOnline ? 'online' : 'offline';
    },
  });

  return {
    connectivityStatus,
  };
}
