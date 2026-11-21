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

/**
 * useScreenShareUi — UI state and dialogs for screen sharing.
 *
 * Extracted from use-in-calls.ts.
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { DialogsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import type { useStreamsStore } from '@video/common/store/streams.store';
import type { PeerVideo } from '~/index';
import type { OwnScreen, SharedStream } from '@video/common/types';
import ScreenShareChoiceDialog from '@video/desktop/components/dialogs/screen-share-choice-dialog/screen-share-choice-dialog.vue';

type StreamsStore = ReturnType<typeof useStreamsStore>;

export interface UseScreenShareUiParams {
  streams: StreamsStore;
  remoteParticipantsList: ComputedRef<
    Array<{ addr: string; stream?: MediaStream | null; name?: string }>
  >;
  activePeerVideos: ComputedRef<PeerVideo[]>;
  dialog: DialogsPlugin;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: (...args: any[]) => string;
  ownScreens: Ref<readonly OwnScreen[] | OwnScreen[] | null | undefined>;
  isSharingOwnDeskSound: Ref<boolean> | { readonly value: boolean };
  setOwnDeskSoundSharing: (value: boolean) => void;
  addOwnScreen: (stream: MediaStream, type: OwnScreen['type'], srcId: string, name: string) => void;
  removeOwnScreen: (srcId: string) => void | Promise<void>;
  isParticipantListOpen: Ref<boolean>;
}

export function useScreenShareUi(params: UseScreenShareUiParams) {
  const {
    streams,
    remoteParticipantsList,
    activePeerVideos,
    dialog,
    t,
    ownScreens,
    isSharingOwnDeskSound,
    setOwnDeskSoundSharing,
    addOwnScreen,
    removeOwnScreen,
    isParticipantListOpen,
  } = params;

  const screenShareMode = ref<'row' | 'column'>('row');

  /**
   * Screen share streams from remote participants.
   */
  const peerSharedStreams = computed(() => {
    return remoteParticipantsList.value
      .filter(p => p.addr.startsWith('screen:') && p.stream)
      .map(p => {
        const parts = p.addr.split(':');
        const screenOwnerAddr = parts[1] || '';
        const screenName = streams.screenNameMap.get(p.addr) || p.name || '';
        const cleanAddr = screenOwnerAddr.split('@')[0] || screenOwnerAddr;
        return {
          peerAddr: p.addr,
          peerName: `[${cleanAddr}] ${screenName}`,
          stream: p.stream!,
        };
      });
  });

  /**
   * Whether screen-share controls may be used.
   * - Host: at least one other real participant must have joined.
   * - Client: must already see the host's stream.
   * - Only one participant may share at a time: if a peer is already sharing
   *   and this user is not the sharer, the control stays disabled.
   */
  const canShareScreen = computed<boolean>(() => {
    const someoneElseSharing = peerSharedStreams.value.length > 0;
    const iAmSharing = (ownScreens.value?.length ?? 0) > 0;
    if (someoneElseSharing && !iAmSharing) {
      return false;
    }

    if (streams.isHost) {
      // Require actual media, not just a roster entry — otherwise a seeded
      // 'invited' participant (no stream yet) would let the host share a
      // screen before anyone has actually joined.
      return remoteParticipantsList.value.some(
        participant => !participant.addr.startsWith('screen:') && !!participant.stream,
      );
    }

    const hostAddr = streams.hostAddress;
    return !!hostAddr && activePeerVideos.value.some(peer => peer.peerAddr === hostAddr);
  });

  function toggleScreenShareMode() {
    screenShareMode.value = screenShareMode.value === 'row' ? 'column' : 'row';
  }

  async function openScreenShareChoice() {
    if (!canShareScreen.value) {
      return;
    }

    console.log('<-- OPEN SCREEN SHARE CHOICE --> ', ScreenShareChoiceDialog);
    console.log(dialog);
    isParticipantListOpen.value = false;

    // Single source per participant: pass at most one initially shared item.
    const initiallyShared = (ownScreens.value || []).slice(0, 1).map(s => ({
      srcId: s.srcId,
      stream: s.stream,
      type: s.type,
      name: s.name,
    }));

    const res = await dialog.$openDialog<{ selected: SharedStream[]; selectedDeskSound: boolean }>(
      ScreenShareChoiceDialog,
      {
        initiallyShared,
        initialDeskSoundShared: isSharingOwnDeskSound.value,
        dialogProps: {
          title: t('call.sharing.title'),
          cssStyle: {
            width: '95vw',
            height: '95dvh',
          },
          closeOnClickOverlay: false,
        },
      },
    );

    const { event, data } = res;
    if (event === 'confirm' && data) {
      // Enforce single-select even if dialog returns more.
      const selected = (data.selected || []).slice(0, 1);
      const selectedDeskSound = data.selectedDeskSound;
      const selectedIds = new Set(selected.map(s => s.srcId));
      const previous = [...(ownScreens.value || [])];
      const previousIds = new Set(previous.map(s => s.srcId));

      // Remove sources that are no longer selected (stop / replace).
      for (const prev of previous) {
        if (!selectedIds.has(prev.srcId)) {
          await removeOwnScreen(prev.srcId);
        }
      }

      // Add newly selected source (at most one).
      for (const shared of selected) {
        if (!previousIds.has(shared.srcId)) {
          addOwnScreen(shared.stream, shared.type, shared.srcId, shared.name);
        }
      }

      setOwnDeskSoundSharing(selected.length > 0 ? selectedDeskSound : false);

      console.log(`[useInCalls] Screen sharing updated: ${selected.length} source(s)`);
    }
  }

  return {
    screenShareMode,
    canShareScreen,
    peerSharedStreams,
    toggleScreenShareMode,
    openScreenShareChoice,
  };
}
