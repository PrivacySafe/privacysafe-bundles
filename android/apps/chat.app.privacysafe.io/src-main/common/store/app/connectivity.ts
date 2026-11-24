/*
Copyright (C) 2024 - 2026 3NSoft Inc.

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
// One state per window, held by the app store and shared by everything in it
// that shows or acts on the connection.
//
// It used to be isOnline() read once a minute, which only says the device has
// a network: the window said "online" while the mail server was out of reach
// and nothing could be sent, received or synchronized. Now it is the platform's
// connectivity events plus what the background component learns from its own
// probe of the server; see src-main/common/utils/connectivity-status.ts.
import { computed, ref } from 'vue';
import { makeLogger } from '@shared/logger';
import type { ConnectivityStatus } from '~/app.types.ts';
import {
  type ConnectivityState,
  type ServerReachability,
  nextConnectivityState,
  toConnectivityStatus,
  withServerReachability,
} from '@main/common/utils/connectivity-status.ts';

const log = makeLogger('Connectivity');

export function useConnectivityStatus() {
  const state = ref<ConnectivityState>({ network: false, server: 'unknown' });

  /** Set once the platform has said whether the device has a network at all. */
  const isNetworkKnown = ref(false);

  const connectivityStatus = computed<ConnectivityStatus>(() => toConnectivityStatus(state.value));

  /**
   * Both halves of the state come from evidence rather than from defaults.
   * Until then the status is shown, but changes of it are not announced: going
   * from the initial guess to the first real reading is not news to the user.
   */
  const isConnectivitySettled = computed(() => isNetworkKnown.value && (state.value.server !== 'unknown'));

  let stopWatch: (() => void) | undefined;

  async function initialize() {
    if (stopWatch) {
      return;
    }
    const connectivity = w3n.connectivity;
    if (!connectivity) {
      return;
    }

    // Subscribed before the first read, so that nothing falls in between.
    stopWatch = connectivity.watch({
      next: event => {
        isNetworkKnown.value = true;
        state.value = nextConnectivityState(state.value, event);
      },
      error: err => log.error('Error while watching the connectivity', err),
    });

    try {
      const assessment = await connectivity.isOnline();
      // An event may have come first, and it is the fresher reading.
      if (!isNetworkKnown.value) {
        isNetworkKnown.value = true;
        state.value = { ...state.value, network: assessment.startsWith('online') };
      }
    } catch (err) {
      log.error('Failed to read whether the device is online', err);
    }
  }

  /**
   * Takes in what the background component learned from its own probe of the
   * server. Needed besides the socket events: should the platform not restart
   * the inbox socket after a graceful close, nothing else would ever tell that
   * the server is out of reach.
   */
  function reportServerReachability(reachability: boolean | ServerReachability): void {
    if (reachability === 'unknown') {
      return;
    }
    const reachable = (reachability === true) || (reachability === 'up');
    if (reachable) {
      isNetworkKnown.value = true;
    }
    state.value = withServerReachability(state.value, reachable);
  }

  function stopConnectivityCheck() {
    stopWatch?.();
    stopWatch = undefined;
  }

  return {
    connectivityStatus,
    isConnectivitySettled,

    initialize,
    reportServerReachability,
    stopConnectivityCheck,
  };
}
