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

/**
 * Own Screen Share — Star (Host-Client) architecture implementation.
 *
 * Screen sharing in Star architecture:
 * - Client: sends screen tracks to Host via the existing RTCPeerConnection
 * - Host: receives screen tracks and retransmits them to other clients
 * - Screen tracks are identified by stream.id with "screen:" prefix
 */

import { ref } from 'vue';
import { toggleAudioIn } from '@video/common/store/utils/utils.ts';
import { toRO } from '@main/common/utils/readonly.ts';
import type { OwnScreen } from '@video/common/types';
import type { ClientWebRTCChannel, HostWebRTCChannel } from '@video/common/types/star.types';

/**
 * Parameters for useOwnScreenShare.
 */
export interface OwnScreenShareParams {
  /** Client WebRTC channel for sending screen tracks to host */
  clientChannel?: ClientWebRTCChannel | null;
  /** Host WebRTC channel for adding screen tracks directly to clients (when host is sharing) */
  hostChannel?: HostWebRTCChannel | null;
  /** Own mailerId for screen stream identification */
  ownMailerId?: string;
  /** Callback when a screen is removed — used to clean up remote participants */
  onScreenRemoved?: (mailerId: string, srcId: string) => void;
}

export function useOwnScreenShare(params?: OwnScreenShareParams) {
  const ownScreens = ref<OwnScreen[] | null>(null);
  const ownDeskSound = ref(false);

  function setOwnDeskSoundSharing(val: boolean) {
    if (val) {
      if (!ownScreens.value) {
        throw new Error(`Can't share desk audio, when no screens shared`);
      }
      toggleAudioIn(ownScreens.value[0].stream, true);
    } else {
      if (ownScreens.value) {
        toggleAudioIn(ownScreens.value[0].stream, false);
      }
    }
    ownDeskSound.value = val;
  }

  /**
   * Add screen to share — sends screen tracks to Host via clientChannel.
   * The screen stream gets a special ID: screen:{mailerId}
   *
   * Only one own screen is allowed. Callers must remove the previous source
   * before adding a different one (replace flow in openScreenShareChoice).
   */
  function addOwnScreen(
    stream: MediaStream,
    type: OwnScreen['type'],
    srcId: string,
    name: string,
  ) {
    if (ownScreens.value?.some(s => s.srcId === srcId)) {
      console.warn(`[own-screen-share] addOwnScreen() — srcId ${srcId} already shared, skip`);
      return;
    }
    if (ownScreens.value && ownScreens.value.length > 0) {
      console.warn(
        '[own-screen-share] addOwnScreen() — another screen is already shared; remove it first',
      );
      return;
    }

    toggleAudioIn(stream, false);
    // Screen content is detail, not motion: the hint steers the encoder (and
    // applyVideoBitrateLimit, which keys the screen bitrate profile off it)
    // toward keeping resolution over frame rate. Set before the tracks reach
    // any RTCPeerConnection.
    stream.getVideoTracks().forEach(track => {
      track.contentHint = 'detail';
    });
    if (!ownScreens.value) {
      ownScreens.value = [];
    }
    ownScreens.value.push({ stream, type, srcId, name });

    // Send screen tracks to host via clientChannel (when client is sharing)
    // OR add screen tracks directly to all clients via hostChannel (when host is sharing)
    const clientChannel = params?.clientChannel;
    const hostChannel = params?.hostChannel;
    const mailerId = params?.ownMailerId;

    if (clientChannel && mailerId) {
      // Client mode: send screen tracks to host via clientChannel
      stream.getTracks().forEach(track => {
        clientChannel.addScreenTrack(track, stream, mailerId, srcId, name);
      });
      console.log(`[own-screen-share] Screen tracks sent to host (screen:${mailerId}:${srcId})`);
    } else if (hostChannel && mailerId) {
      // Host mode: add screen tracks directly to all client connections
      stream.getTracks().forEach(track => {
        hostChannel.addOwnScreenTrack(track, stream, mailerId, srcId, name);
      });
      console.log(`[own-screen-share] Host screen tracks added to all clients (screen:${mailerId}:${srcId})`);
    } else {
      console.warn('[own-screen-share] addOwnScreen() — no clientChannel, hostChannel, or mailerId provided');
    }
  }

  /**
   * Remove screen from share — removes screen tracks from the PeerConnection.
   */
  async function removeOwnScreen(srcId: string) {
    if (!ownScreens.value) {
      return;
    }

    const ind = ownScreens.value.findIndex(info => (info.srcId === srcId));
    if (ind < 0) {
      return;
    }

    const screenInfo = ownScreens.value[ind];
    const clientChannel = params?.clientChannel;
    const hostChannel = params?.hostChannel;
    const mailerId = params?.ownMailerId;

    // Remove screen tracks from the PeerConnection (client)
    // Await renegotiation so Host is notified via SDP + participant-left
    if (clientChannel && mailerId) {
      const tracks = screenInfo.stream.getTracks();
      await Promise.all(tracks.map(track =>
        clientChannel.removeScreenTrack(track, mailerId, srcId).catch(err => {
          console.error('[own-screen-share] Failed to remove screen track:', err);
        })
      ));
      console.log('[own-screen-share] Screen tracks removed from PeerConnection');
    }

    // Remove screen tracks from all clients (host side)
    if (hostChannel && mailerId) {
      hostChannel.removeOwnScreenTrack(mailerId, srcId);
    }

    // Notify the caller to clean up remoteParticipants (host-only screen share entry)
    params?.onScreenRemoved?.(mailerId!, srcId);

    // Stop local capture tracks after they are removed from the PeerConnection.
    try {
      screenInfo.stream.getTracks().forEach(track => track.stop());
    } catch {
      // ignore
    }

    ownScreens.value.splice(ind, 1);
    if (ownScreens.value.length === 0) {
      ownScreens.value = null;
      ownDeskSound.value = false;
    }
  }

  return {
    ownScreens: toRO(ownScreens),
    isSharingOwnDeskSound: toRO(ownDeskSound),

    setOwnDeskSoundSharing,
    addOwnScreen,
    removeOwnScreen,
  };
}
