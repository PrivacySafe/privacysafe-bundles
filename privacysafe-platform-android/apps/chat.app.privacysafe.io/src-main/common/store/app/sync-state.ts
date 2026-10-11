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
import { toRO } from '@main/common/utils/readonly.ts';
import { chatService } from '@main/common/services/external-services.ts';
import type { SyncActivityView, SyncPhase } from '~/services.types.ts';

/**
 * State of synchronization with the user's other devices, as shown in the app
 * toolbar.
 *
 * Two sources feed it: events from the background component, and one request for
 * the current value at start. The request is needed because events are only built
 * while a GUI is attached, and the catch-up scan of a device that has just been
 * turned on often finishes before that.
 */
export function useSyncState() {
  const isSyncing = ref(false);
  const syncPending = ref(0);
  const syncPhase = ref<SyncPhase>('idle');
  const syncStalled = ref(false);

  /**
   * Both sources are unordered relative to each other: the answer to the initial
   * request can arrive after an event that is already newer than it. The snapshot
   * number is what keeps the older one from winning.
   */
  let lastSeq = -1;

  function applySyncState(state: SyncActivityView): void {
    if (state.seq <= lastSeq) {
      return;
    }
    lastSeq = state.seq;
    isSyncing.value = state.syncing;
    syncPending.value = state.pending;
    syncPhase.value = state.phase;
    syncStalled.value = state.stalled;
  }

  async function refreshSyncState(): Promise<void> {
    applySyncState(await chatService.getSyncActivityState());
  }

  const syncStatusText = computed(() => {
    // "Cannot send" is not a slower "Synchronizing…", and the label has to say
    // so: work that is stuck outside the app is exactly what the user might act
    // on (reconnect, wait), while a running synchronization needs nothing.
    if (syncStalled.value) {
      return 'app.sync.stalled';
    }
    // The catch-up scan gets its own words, and needs them: it is the one phase
    // that is not about the user's other devices - it is the inbox being read
    // for everything that arrived while the app was closed. "Synchronizing…" is
    // simply untrue for a user who has a single device, and they are shown this
    // phase and no other (see currentView in sync-activity.ts).
    if (syncPhase.value === 'catch-up') {
      return 'app.sync.catchUp';
    }
    // A count of one adds noise without information: "Synchronizing… (1)" says
    // no more than "Synchronizing…".
    return (syncPending.value > 1) ? 'app.sync.labelWithCount' : 'app.sync.label';
  });

  /**
   * Whether the toolbar shows anything about synchronization at all.
   *
   * Wider than `isSyncing`: the show/hide gate of the tracker is about work in
   * progress, and stalled work is by definition not in progress - it would be
   * hidden the moment it became worth reporting.
   */
  const showSyncStatus = computed(() => isSyncing.value || syncStalled.value);

  return {
    isSyncing: toRO(isSyncing),
    syncPending: toRO(syncPending),
    syncPhase: toRO(syncPhase),
    syncStalled: toRO(syncStalled),
    syncStatusText,
    showSyncStatus,

    applySyncState,
    refreshSyncState,
  };
}
