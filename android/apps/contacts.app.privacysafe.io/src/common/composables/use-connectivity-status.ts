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
// One state per window, shared by everything in it that shows or acts on the
// connection: the status line and the share dialog used to subscribe each on
// its own, and each started out saying "offline" until the next event came.
import { computed, ref } from 'vue';
import type { ConnectivityStatus } from '@main/types';
import {
  type ConnectivityState,
  type ServerReachability,
  nextConnectivityState,
  toConnectivityStatus,
  withServerReachability,
} from '@main/common/utils/connectivity-status';

const state = ref<ConnectivityState>({ network: false, server: 'unknown' });

/** Set once the platform has said whether the device has a network at all. */
const isNetworkKnown = ref(false);

const connectivityStatus = computed<ConnectivityStatus>(() => toConnectivityStatus(state.value));

/**
 * Both halves of the state come from evidence rather than from defaults. Until
 * then the status is shown, but changes of it are not announced: going from
 * the initial guess to the first real reading is not news to the user.
 */
const isConnectivitySettled = computed(() => isNetworkKnown.value && (state.value.server !== 'unknown'));

let isWatching = false;

function startWatching(): void {
  if (isWatching) {
    return;
  }
  isWatching = true;

  const connectivity = w3n.connectivity;
  if (!connectivity) {
    return;
  }

  connectivity.isOnline()
    .then(assessment => {
      // An event may have come first, and it is the fresher reading.
      if (!isNetworkKnown.value) {
        isNetworkKnown.value = true;
        state.value = { ...state.value, network: assessment === 'online_80%' };
      }
    })
    .catch(() => undefined);

  connectivity.watch({
    next: event => {
      isNetworkKnown.value = true;
      state.value = nextConnectivityState(state.value, event);
    },
    error: err => {
      void w3n.log('error', 'Error while watching the connectivity', err);
    },
  });
}

/**
 * Takes in what the contacts service learned from its own request to the
 * storage server. Needed besides the socket events: the platform does not
 * restart the storage socket after a graceful close, and then nothing else
 * would ever tell that the server is out of reach.
 */
export function reportServerReachability(reachability: boolean | ServerReachability): void {
  if (reachability === 'unknown') {
    return;
  }
  const reachable = (reachability === true) || (reachability === 'up');
  if (reachable) {
    isNetworkKnown.value = true;
  }
  state.value = withServerReachability(state.value, reachable);
}

export function useConnectivityStatus() {
  startWatching();

  return {
    connectivityStatus,
    isConnectivitySettled,
  };
}
