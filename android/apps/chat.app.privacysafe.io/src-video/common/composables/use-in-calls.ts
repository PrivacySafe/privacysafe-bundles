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
 * useInCalls — Star (Host-Client) Architecture Integration (orchestrator)
 *
 * Bridges the WebRTC layer with the reactive Vue 3 UI layer (streams.store).
 *
 * Handlers: use-webrtc-callbacks.ts
 * Screen share UI: use-screen-share-ui.ts
 */

import { computed, inject, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import isEmpty from 'lodash/isEmpty';
import difference from 'lodash/difference';
import {
  DIALOGS_KEY,
  DialogsPlugin,
  NOTIFICATIONS_KEY,
  NotificationsPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { useAppStore } from '@video/common/store/app.store';
import { useStreamsStore } from '@video/common/store/streams.store';
import type { PeerVideo } from '~/index';
import type { ClientWebRTCChannel, HostWebRTCChannel, ConnectingPeer } from '@video/common/types';
import { createClientChannel } from '@video/common/services/client-channel';
import { createHostChannel } from '@video/common/services/host-channel';
import { createClientSignalingChannel } from '@video/common/services/client-signaling-channel';
import { createHostSignalingChannel } from '@video/common/services/host-signaling-channel';
import {
  registerFullEndCall,
  registerCallDeclinedHandler,
  registerPeerLeftHandler,
  registerHostHeartbeatHandler,
  registerUndeliveredInviteHandler,
  registerRejoiningPeerHandler,
  registerRoleSwitchHandler,
  notifyHostEndedCall,
  type PeerLeftParams,
} from '@video/common/services/video-chat-service/video-chat-srv';
import { useOwnScreenShare } from '@video/common/store/utils/own-screen-share';
import {
  CONNECTION_STATUS_I18N_KEY,
  BANNER_HIDDEN_STATUSES,
  SETTLED_STATUSES,
  WAITING_STATUSES,
} from '@video/common/utils/connection-status-i18n';
import {
  NO_ANSWER_SWEEP_INTERVAL_MS,
  NO_ANSWER_TIMEOUT_MS as NO_ANSWER_TIMEOUT_MILLIS,
  peersToMarkNoAnswer,
} from '@video/common/utils/no-answer';
import { useWebRtcCallbacks } from './use-webrtc-callbacks';
import { useScreenShareUi } from './use-screen-share-ui';
import { useRingback } from './use-ringback';

/**
 * How long an invited peer can stay silent before the banner marks them as not
 * responding. Lives with the rule that uses it (see peersToMarkNoAnswer).
 */
const NO_ANSWER_TIMEOUT_MS = NO_ANSWER_TIMEOUT_MILLIS;

/**
 * How long a one-to-one call may go without ever reaching a connected peer
 * before it closes itself.
 *
 * Every other way out of a call needs something to happen: the peer's
 * 'disconnect' to arrive, or a connection that once worked to break
 * (DISCONNECT_GRACE_MILLIS, PEER_CRASH_END_CALL_MS). A call that never connects
 * in the first place, and whose peer's 'disconnect' never gets delivered, has
 * none of those - the window just stays open until the user closes it by hand.
 *
 * Twice NO_ANSWER_TIMEOUT_MS, so the banner has said "not responding" long
 * before this fires.
 */
const CALL_SETUP_TIMEOUT_MS = 90_000;

/**
 * How long a GROUP call may sit with nobody having joined before its host closes
 * it.
 *
 * Longer than the one-to-one bound because a group host waiting alone for a while
 * is normal, but not unbounded as it used to be: with every invitation lost on the
 * server, the window stayed open with a "waiting for participants" banner
 * indefinitely (2026-08-12). Past the invitees' own ringing window
 * (RINGING_NO_ANSWER_TIMEOUT_MILLIS = 90s in call-state.ts) plus room for ASMail
 * latency, so it never cuts off someone who could still pick up.
 */
const GROUP_HOST_SETUP_TIMEOUT_MS = 150_000;

export function useInCalls() {
  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const notification = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const appStore = useAppStore();
  const { user: ownName } = storeToRefs(appStore);

  const streams = useStreamsStore();
  const { isGroupChat, ownVA, remoteParticipantsList, starConfig, chatObjId } = storeToRefs(streams);

  // ===========================================================================
  // WebRTC Channel References
  // ===========================================================================

  const clientChannel = ref<ClientWebRTCChannel | null>(null);
  const hostChannel = ref<HostWebRTCChannel | null>(null);

  // ===========================================================================
  // Screen Share (store wiring)
  // ===========================================================================

  const { ownScreens, isSharingOwnDeskSound, setOwnDeskSoundSharing, addOwnScreen, removeOwnScreen } =
    useOwnScreenShare({
      get clientChannel() {
        return clientChannel.value;
      },
      get hostChannel() {
        return hostChannel.value;
      },
      ownMailerId: streams.ownAddr,
      onScreenRemoved(mailerId: string, srcId: string) {
        const screenAddr = `screen:${mailerId}:${srcId}`;
        streams.removeRemoteParticipant(screenAddr);
      },
    });

  // ===========================================================================
  // UI State
  // ===========================================================================

  const isFullscreen = ref(false);
  const isParticipantListOpen = ref(false);

  // ===========================================================================
  // peerVideos — mapped from remoteParticipants in the store
  // ===========================================================================

  function getContactName(addr: string): string {
    const participant = streams.remoteParticipants.get(addr);
    if (participant && participant.name && participant.name !== addr) {
      return participant.name;
    }
    const atIndex = addr.indexOf('@');
    return atIndex > 0 ? addr.substring(0, atIndex) : addr;
  }

  const peerVideos = computed<PeerVideo[]>(() => {
    return remoteParticipantsList.value
      .filter(participant => !participant.addr.startsWith('screen:'))
      .map(participant => ({
        peerAddr: participant.addr,
        peerName: getContactName(participant.addr),
        videoMuted: participant.videoMuted,
        audioMuted: participant.audioMuted,
        vaStream: participant.stream ?? undefined,
        isReconnecting: participant.reconnecting,
      }));
  });

  const activePeerVideos = computed(() => peerVideos.value.filter(item => item.vaStream));
  const activePeerVideosForObservation = computed(() =>
    JSON.stringify(activePeerVideos.value.map(p => p.peerAddr)),
  );

  // Derived directly from remoteParticipantsList (not peerVideos) so each entry
  // carries its ConnectionStatus — peerVideos only knows stream presence.
  const connectingPeers = computed<ConnectingPeer[]>(() =>
    remoteParticipantsList.value
      .filter(
        p =>
          !p.addr.startsWith('screen:') &&
          !p.stream &&
          !BANNER_HIDDEN_STATUSES.has(p.connectionStatus),
      )
      .map(p => {
        const peerName = getContactName(p.addr);
        return {
          peerAddr: p.addr,
          peerName,
          status: p.connectionStatus,
          statusText: t(CONNECTION_STATUS_I18N_KEY[p.connectionStatus], { user: peerName }),
        };
      }),
  );

  /**
   * Peers actively in a handshake (shown as individual banner rows).
   *
   * Both sets are subtracted, and neither is the complement of the other: those
   * still being waited for are rolled up into the summary row below, while those
   * whose answer is settled - declined, unanswered, never reached - leave the
   * banner altogether. Their status stays visible in the participants panel,
   * which reads the same `connectingPeers`.
   */
  const activeConnectingPeers = computed(() =>
    connectingPeers.value.filter(
      p => !WAITING_STATUSES.has(p.status) && !SETTLED_STATUSES.has(p.status),
    ),
  );

  /**
   * Peers still being waited for, rolled up into a single summary row. Counted
   * by status rather than as "everyone who is not actively connecting": that
   * difference is what used to promise the arrival of a peer who had already
   * declined or rung out.
   */
  const waitingPeersCount = computed(() =>
    connectingPeers.value.filter(p => WAITING_STATUSES.has(p.status)).length,
  );

  /**
   * The caller hears the ringtone while the people called are still being rung:
   * someone is still 'invited' and nobody has answered yet. In a group call the
   * first answer ends it - the call has started by then, and ringing on until
   * the last invitee makes up their mind would talk over the conversation.
   */
  const isRingingOut = computed(() => {
    if (!streams.isHost) {
      return false;
    }
    const peers = remoteParticipantsList.value.filter(p => !p.addr.startsWith('screen:'));
    const someoneAnswered = peers.some(
      p =>
        !!p.stream ||
        (!WAITING_STATUSES.has(p.connectionStatus) &&
          !SETTLED_STATUSES.has(p.connectionStatus) &&
          !BANNER_HIDDEN_STATUSES.has(p.connectionStatus)),
    );
    return !someoneAnswered && peers.some(p => WAITING_STATUSES.has(p.connectionStatus));
  });

  const { stopRingback } = useRingback(isRingingOut);

  // ===========================================================================
  // Peer crash → delayed endCall (1-1 any side; group when host is lost)
  // Bound after endCall is defined; callbacks use this holder (hoisting-safe).
  // ===========================================================================

  const PEER_CRASH_END_CALL_MS = 5000;
  let peerCrashEndTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPeerCrashEndTimer(): void {
    if (peerCrashEndTimer !== null) {
      clearTimeout(peerCrashEndTimer);
      peerCrashEndTimer = null;
    }
  }

  const peerCrashEndCallApi = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    schedule: (_peerAddr: string) => {
      /* assigned after endCall */
    },
  };

  // ===========================================================================
  // Extracted composables
  // ===========================================================================

  const {
    handleRemoteTrack,
    handleRemoteTrackDetached,
    handleClientTrack,
    handleClientConnected,
    handleClientDisconnected,
    handleConnectionStateChange,
    handleClientConnectionStateChange,
    handleCallDeclined,
    handlePeerAnswered,
    handleStreamStateChanged,
    handleRemoteStreamStateChanged,
    handleStreamSenderInfo,
    handleParticipantLeft,
    handleParticipantReconnecting,
  } = useWebRtcCallbacks({
    streams,
    notification,
    t,
    getContactName,
    onPeerCrashEndCall: peerAddr => peerCrashEndCallApi.schedule(peerAddr),
    // A getter, not the channel itself: the client channel is created later,
    // when the call actually starts.
    requestStreamMappings: () => clientChannel.value?.requestStreamMappings(),
    // Paces the wait for a stream mapping to the transport carrying it.
    isSignalingFast: () => clientChannel.value?.isSignalingFast() ?? false,
  });

  const {
    screenShareMode,
    canShareScreen,
    peerSharedStreams,
    toggleScreenShareMode,
    openScreenShareChoice,
  } = useScreenShareUi({
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
  });

  // ===========================================================================
  // Media Controls
  // ===========================================================================

  function toggleMicStatus() {
    streams.setMicOn(!streams.isMicOn);
  }

  function toggleCamStatus() {
    streams.setCamOn(!streams.isCamOn);
  }

  // ===========================================================================
  // WebRTC Channel Initialization
  // ===========================================================================

  function initializeWebRTCChannel(): void {
    const config = starConfig.value;
    const localStream = ownVA.value?.stream;
    const chatId = chatObjId.value;

    if (!config || !localStream || !chatId) {
      console.warn('[useInCalls] Cannot initialize WebRTC channel: missing config, stream, or chatId');
      return;
    }

    if (config.role === 'host') {
      initializeHostChannel(config, localStream, chatId);
    } else {
      initializeClientChannel(config, localStream, chatId);
    }
  }

  function initializeHostChannel(
    config: NonNullable<typeof starConfig.value>,
    localStream: MediaStream,
    chatId: NonNullable<typeof chatObjId.value>,
  ): void {
    const signalingChannel = createHostSignalingChannel({
      ownAddr: streams.ownAddr,
      chatId,
      callSessionId: streams.callSessionId,
    });

    streams.setHostSignalingChannel(signalingChannel);

    hostChannel.value = createHostChannel({
      ownAddr: streams.ownAddr,
      rtcConfig: config.rtcConfig,
      localStream,
      signalingChannel,
      onClientConnected: handleClientConnected,
      onClientDisconnected: handleClientDisconnected,
      onClientConnectionStateChange: handleClientConnectionStateChange,
      onClientTrack: handleClientTrack,
      onStreamStateChanged: handleStreamStateChanged,
      onStreamSenderInfo: handleStreamSenderInfo,
      onParticipantLeft: handleParticipantLeft,
      onParticipantReconnecting: handleParticipantReconnecting,
      participantCount: streams.participantCount,
      getOwnScreenTracks: () => {
        if (!ownScreens.value) { return []; }
        return ownScreens.value.flatMap(s =>
          s.stream.getTracks().map(track => ({
            track,
            mailerId: streams.ownAddr,
            srcId: s.srcId,
            screenName: s.name,
          })),
        );
      },
    });

    console.log('[useInCalls] Host WebRTC channel initialized');
  }

  function initializeClientChannel(
    config: NonNullable<typeof starConfig.value>,
    localStream: MediaStream,
    chatId: NonNullable<typeof chatObjId.value>,
  ): void {
    const signalingChannel = createClientSignalingChannel({
      hostAddr: config.hostAddr,
      ownAddr: streams.ownAddr,
      chatId,
      callSessionId: streams.callSessionId,
    });

    streams.setClientSignalingChannel(signalingChannel);

    clientChannel.value = createClientChannel({
      hostAddr: config.hostAddr,
      ownAddr: streams.ownAddr,
      rtcConfig: config.rtcConfig,
      localStream,
      signalingChannel,
      onRemoteTrack: handleRemoteTrack,
      onRemoteTrackDetached: handleRemoteTrackDetached,
      onConnectionStateChange: handleConnectionStateChange,
      onRemoteStreamStateChanged: handleRemoteStreamStateChanged,
      onStreamSenderInfo: handleStreamSenderInfo,
      onParticipantLeft: handleParticipantLeft,
      onParticipantReconnecting: handleParticipantReconnecting,
      onCallFull: (maxParticipants, currentParticipants) => {
        notification.$createNotice({
          type: 'error',
          content: t('va.text.call_full', { current: currentParticipants, max: maxParticipants }),
        });
      },
      onHostEndedCall: handleHostEndedCall,
      onHostUnreachable: handleHostUnreachable,
      onDroppedByHost: handleDroppedByHost,
      participantCount: streams.participantCount,
      isGroupCall: !!chatId.isGroupChat,
      // Read on every offer, not captured once: the roster this reserves relay
      // slots from can grow between a pc and its replacement.
      reservedPeers: () => streams.expectedPeers.map(peer => peer.addr),
    });

    clientChannel.value.createAndSendOffer().catch(err => {
      console.error('[useInCalls] Failed to send SDP Offer:', err);
    });

    console.log('[useInCalls] Client WebRTC channel initialized, Offer sent');
  }

  // ===========================================================================
  // Disconnect Handling
  // ===========================================================================

  /** Fallback in case the 'host-ended-call' IPC round-trip to Deno never completes. */
  const HOST_END_FALLBACK_MS = 1500;

  /**
   * Client: host signaled call end via the signaling channel (DataChannel or
   * ASMail 'disconnect'). Report it to Deno so the full teardown path
   * (GUI close + main-window notice) runs; fall back to a local endCall()
   * if that round-trip doesn't come back in time.
   */
  function handleHostEndedCall(): void {
    console.log('[useInCalls] Host ended the call — notifying background');
    clearPeerCrashEndTimer();
    notifyHostEndedCall();
    setTimeout(() => {
      void endCall();
    }, HOST_END_FALLBACK_MS);
  }

  /**
   * Client (group): the host-silence watchdog fired — its heartbeats stopped
   * while we were not connected, and its 'disconnect' evidently could not be
   * delivered to us. End the call locally. Deliberately NOT reported as
   * "host ended" to the background (notifyHostEndedCall): we do not know that
   * for sure, so deno computes its own end state ('rejoinable' keeps the Join
   * button, which then expires by the main window's heartbeat-timeout logic).
   */
  function handleHostUnreachable(): void {
    console.warn('[useInCalls] Host silent past threshold — ending the call locally');
    const hostAddr = streams.hostAddress || 'host';
    notification.$createNotice({
      type: 'info',
      content: t('va.text.host_unreachable', { user: getContactName(hostAddr) }),
    });
    void endCall();
  }

  /**
   * Client: the host sent 'dropped' — it gave up on our link after exhausting
   * its retries, while the call itself goes on. Same teardown as
   * handleHostUnreachable(): end locally WITHOUT notifyHostEndedCall(), so
   * deno computes 'rejoinable' and the main window keeps an honest Join
   * button (confirmed by the host's continuing heartbeats).
   */
  function handleDroppedByHost(): void {
    console.warn('[useInCalls] Host dropped this client — ending the call locally (rejoin possible)');
    const hostAddr = streams.hostAddress || 'host';
    notification.$createNotice({
      type: 'info',
      content: t('va.text.host_unreachable', { user: getContactName(hostAddr) }),
    });
    void endCall();
  }

  async function endCallWhenPeerCloses(params: PeerLeftParams) {
    const { peerAddr, sentAt } = params;

    // A departure this client has already superseded by re-joining: acting on
    // it would drop the connection it is being served on right now, and the
    // client would have to reconnect from scratch (group call of 2026-08-12).
    // Checked before anything else, including the crash timer, since none of it
    // applies to a client that never left as far as this call is concerned.
    if (hostChannel.value?.isStaleClientDisconnect(peerAddr, sentAt)) {
      return;
    }

    // Graceful path (stage: disconnect) — instant end, no 5s delay.
    clearPeerCrashEndTimer();

    if (streams.isHost) {
      if (!streams.isGroupChat) {
        console.log(`[useInCalls] Host 1-1: peer ${peerAddr} closed — full endCall`);
        await endCall();
        return;
      }
      console.log(`[useInCalls] Host removing client ${peerAddr}`);
      // Deliberately not awaited (same idiom as inside host-channel.ts): the UI
      // drops the participant right away, while renegotiation with the
      // remaining clients settles in the background.
      void hostChannel.value?.removeClient(peerAddr);
      streams.removeRemoteParticipant(peerAddr);
    } else {
      if (peerAddr === streams.hostAddress) {
        console.log('[useInCalls] Host disconnected, ending call');
        await endCall();
      }
    }
  }

  function onPeerConnected(params: { peerAddr: string }) {
    const { peerAddr } = params;

    if (streams.isHost) {
      handleClientConnected(peerAddr);
    } else {
      console.log(`[useInCalls] Connected to Host: ${peerAddr}`);
    }
  }

  // ===========================================================================
  // Call Lifecycle
  // ===========================================================================

  /**
   * Cap on waiting for the leave/end 'disconnect' notice to get on its way
   * when it has to ride ASMail (signaling DataChannel never opened — e.g.
   * leaving a call we never managed to join). Once the delivery sub-system
   * accepted the message, delivery proceeds in the background and survives
   * this window closing; waiting for the full delivery confirmation (12s) is
   * pointless.
   */
  const END_NOTIFY_FLUSH_MAX_MS = 1500;

  let endCallStarted = false;

  async function endCall(): Promise<void> {
    if (endCallStarted) {
      console.log('[useInCalls] endCall() already started — skip');
      return;
    }
    endCallStarted = true;
    clearPeerCrashEndTimer();
    console.log('[useInCalls] endCall() — closing WebRTC channels...');

    try {
      if (clientChannel.value) {
        const notified = clientChannel.value.notifyHostOfLeaving();
        await Promise.race([
          notified,
          new Promise(resolve => setTimeout(resolve, END_NOTIFY_FLUSH_MAX_MS)),
        ]);
        clientChannel.value.close();
        clientChannel.value = null;
      }

      if (hostChannel.value) {
        const notified = hostChannel.value.notifyClientsOfCallEnd();
        await Promise.race([
          notified,
          new Promise(resolve => setTimeout(resolve, END_NOTIFY_FLUSH_MAX_MS)),
        ]);
        hostChannel.value.closeAll();
        hostChannel.value = null;
      }

      streams.setHostSignalingChannel(null);
      streams.setClientSignalingChannel(null);

      await streams.endCall();
    } catch (err) {
      endCallStarted = false;
      throw err;
    } finally {
      // Whatever failed above, the window must not survive endCall(): a
      // teardown error used to leave the user in a dead call window.
      try {
        w3n.closeSelf();
      } catch (err) {
        console.warn('[useInCalls] closeSelf failed (already closed?)', err);
      }
    }
  }

  /**
   * After abnormal peer/app exit: wait PEER_CRASH_END_CALL_MS then endCall.
   * Idempotent — one timer; skipped if endCall already started.
   */
  function scheduleEndCallAfterPeerCrash(peerAddr: string): void {
    if (endCallStarted) {
      console.log(`[useInCalls] peer crash end skipped (endCall already started): ${peerAddr}`);
      return;
    }
    if (peerCrashEndTimer !== null) {
      console.log(`[useInCalls] peer crash end already scheduled — ignore ${peerAddr}`);
      return;
    }
    console.log(
      `[useInCalls] Scheduling endCall in ${PEER_CRASH_END_CALL_MS}ms after peer crash: ${peerAddr}`,
    );
    peerCrashEndTimer = setTimeout(() => {
      peerCrashEndTimer = null;
      console.log(`[useInCalls] Peer crash delay elapsed — endCall (${peerAddr})`);
      void endCall();
    }, PEER_CRASH_END_CALL_MS);
  }

  peerCrashEndCallApi.schedule = scheduleEndCallAfterPeerCrash;

  // Wire full hangup into VideoChatComponent.endCall (Deno endCallInGUI path)
  const unregisterFullEndCall = registerFullEndCall(endCall);

  // Wire 'call declined' signals (invited peer pressed "Decline") into the banner.
  const unregisterCallDeclinedHandler = registerCallDeclinedHandler(handleCallDeclined);

  // Wire the ASMail 'disconnect' fallback (host group role) into the same
  // full-removal path used by the low-latency DC 'disconnect' signal.
  const unregisterPeerLeftHandler = registerPeerLeftHandler(endCallWhenPeerCloses);

  // Wire the host's background-forwarded heartbeat into the client channel's
  // host-silence watchdog (group calls: "host alive but unreachable for big
  // messages" must not be mistaken for "host ended the call").
  const unregisterHostHeartbeatHandler = registerHostHeartbeatHandler(() => {
    clientChannel.value?.noteHostActivity();
  });

  /**
   * An invitation the platform could not deliver (host side). Distinguishes "not
   * reached" from "not answering" in the banner, and says so once - the host has
   * no other way to learn that a peer was never even called.
   */
  function handleUndeliveredInvite(peerAddr: string): void {
    // getParticipant(), not a raw map lookup: the roster is keyed by the address
    // the call was started with, and the one coming back from the background may
    // differ in case - which would leave the gate below reading `undefined` and
    // overwriting a status the write path (applyPeerStatus) does reconcile.
    const participant = streams.getParticipant(peerAddr);
    // Reports arrive per lost copy of 'start', and a repeat of it may have got
    // through in the meantime: anyone past 'invited' is demonstrably reachable.
    if (participant && (participant.connectionStatus !== 'invited')) {
      console.log(
        `[useInCalls] Undelivered invite report for ${peerAddr} ignored `
        + `(status: ${participant.connectionStatus})`,
      );
      return;
    }
    console.warn(`[useInCalls] Invitation to ${peerAddr} was not delivered`);
    handleClientConnectionStateChange(peerAddr, 'not-reached');
    notification.$createNotice({
      type: 'error',
      content: t('va.text.invite_not_delivered', { user: getContactName(peerAddr) }),
    });
  }

  const unregisterUndeliveredInviteHandler =
    registerUndeliveredInviteHandler(handleUndeliveredInvite);

  // A peer said it is on its way in - re-joining, or answering the call in the
  // first place - ahead of the SDP offer that is the only other thing
  // announcing it, and by far the slowest. Host side only: the background sends
  // this notice on to the host alone, and only the host channel can broadcast it
  // to everyone else.
  const unregisterRejoiningPeerHandler = registerRejoiningPeerHandler(peerAddr => {
    handlePeerAnswered(peerAddr);
    if (!hostChannel.value) {
      console.warn(`[useInCalls] Re-join notice from ${peerAddr} with no host channel to announce it on`);
      return;
    }
    hostChannel.value.announceRejoiningPeer(peerAddr);
  });

  /**
   * Our call lost a collision with one the other person started at the same
   * moment (see callCollisionWinner in src-deno/.../utils/call-state.ts), and
   * the background has already made us a client of theirs. The window stays:
   * the host channel goes, nobody having answered it, and the client one comes
   * up in its place through the same watcher on `starConfig` that brought the
   * host one up - which also sends the offer. The camera and microphone stream
   * is the one already running; closeAll() does not touch it.
   */
  const unregisterRoleSwitchHandler = registerRoleSwitchHandler(({ hostAddr }) => {
    if (!streams.isHost || !ownVA.value) {
      console.warn(`[useInCalls] Asked to switch to a client of ${hostAddr}, but not hosting here`);
      return;
    }
    console.log(`[useInCalls] Switching from host to a client of ${hostAddr}`);
    clearSetupTimeout();
    if (hostChannel.value) {
      hostChannel.value.closeAll();
      hostChannel.value = null;
    }
    streams.setHostSignalingChannel(null);
    // The roster was seeded for a host; the client one is seeded afresh below.
    for (const participant of [...remoteParticipantsList.value]) {
      streams.removeRemoteParticipant(participant.addr);
    }
    streams.startCall('incoming', hostAddr);
    armSetupTimeout();
    notification.$createNotice({
      type: 'info',
      content: t('va.text.call_collision_joining', { user: getContactName(hostAddr) }),
      duration: 7000,
    });
  });

  // ===========================================================================
  // Fullscreen
  // ===========================================================================

  function fullscreenchangeHandler() {
    isFullscreen.value = !!document.fullscreenElement;
  }

  /**
   * Closing the call window (e.g. via the OS close button) bypasses
   * endCall() — only 'beforeunload' fires. Notify the other side(s)
   * synchronously here too, so they are not left waiting on the ASMail
   * 'disconnect' message or an ICE-failure timeout.
   */
  function beforeUnloadHandler() {
    if (streams.isHost) {
      void hostChannel.value?.notifyClientsOfCallEnd();
    } else {
      void clientChannel.value?.notifyHostOfLeaving();
    }
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  }

  // ===========================================================================
  // Lifecycle Hooks
  // ===========================================================================

  let noAnswerSweep: ReturnType<typeof setInterval> | null = null;
  let setupTimer: ReturnType<typeof setTimeout> | null = null;
  let stopWatchingForFirstConnection: (() => void) | null = null;

  function clearSetupTimeout(): void {
    if (setupTimer !== null) {
      clearTimeout(setupTimer);
      setupTimer = null;
    }
    stopWatchingForFirstConnection?.();
    stopWatchingForFirstConnection = null;
  }

  /**
   * Closes a call that never got off the ground. See CALL_SETUP_TIMEOUT_MS and
   * GROUP_HOST_SETUP_TIMEOUT_MS for why nothing else would.
   */
  function armSetupTimeout(): void {
    const isGroupHost = isGroupChat.value && streams.isHost;
    if (isGroupChat.value && !isGroupHost) {
      // Deliberate: a group client with a dead link keeps the window plus its
      // reconnect cycle. "Host hung up but the notice never arrived" is handled
      // by the 'outgoing-call-cancelled' system-message fallback and the
      // host-silence watchdog, not by a setup timeout.
      return;
    }
    const timeoutMs = isGroupHost ? GROUP_HOST_SETUP_TIMEOUT_MS : CALL_SETUP_TIMEOUT_MS;

    setupTimer = setTimeout(() => {
      setupTimer = null;
      console.warn(`[useInCalls] No peer connected within ${timeoutMs}ms; ending the call`);
      // Say WHY before closing: a window vanishing on its own with no notice
      // reads as a crash (observed on the test stand, 2026-08-10).
      const peerAddr = remoteParticipantsList.value[0]?.addr;
      notification.$createNotice({
        type: 'info',
        content: isGroupHost
          ? t('va.text.group_call_unanswered')
          : t('va.text.call_setup_timeout', { user: getContactName(peerAddr || 'peer') }),
      });
      endCall();
    }, timeoutMs);

    // One connected peer means the ordinary end-of-call paths apply from here
    // on: a broken connection is a thing that happens, and they handle it.
    // Real connectionStatus only: a stream attaches at setRemoteDescription,
    // long before ICE — clearing the watchdog on it left a call that never
    // carries RTP with no deadline at all (observed 2026-08-10).
    stopWatchingForFirstConnection = watch(
      () => remoteParticipantsList.value.some(p => p.connectionStatus === 'connected'),
      connected => {
        if (connected) {
          clearSetupTimeout();
        }
      },
    );
  }

  function doOnMounted() {
    document.addEventListener('fullscreenchange', fullscreenchangeHandler);
    window.addEventListener('beforeunload', beforeUnloadHandler);

    if (starConfig.value && ownVA.value) {
      initializeWebRTCChannel();
    }

    // Peers seeded as 'invited' who never answer are marked 'no-answer' so the
    // banner doesn't wait on them forever. Swept rather than timed out once:
    // each peer's deadline runs from when it entered the roster, not from this
    // mount, and a tick missed while the window was throttled costs nothing.
    noAnswerSweep = setInterval(() => {
      const addrs = peersToMarkNoAnswer(
        streams.remoteParticipantsList.map(p => ({
          addr: p.addr,
          connectionStatus: p.connectionStatus,
          hasMedia: !!p.stream,
          invitedAt: p.invitedAt,
        })),
        Date.now(),
        NO_ANSWER_TIMEOUT_MS,
      );
      for (const addr of addrs) {
        streams.updateRemoteStatus(addr, 'no-answer');
      }
    }, NO_ANSWER_SWEEP_INTERVAL_MS);

    armSetupTimeout();
  }

  function doBeforeUnmount() {
    stopRingback();
    document.removeEventListener('fullscreenchange', fullscreenchangeHandler);
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    unregisterFullEndCall();
    unregisterCallDeclinedHandler();
    unregisterUndeliveredInviteHandler();
    unregisterRejoiningPeerHandler();
    unregisterRoleSwitchHandler();
    unregisterPeerLeftHandler();
    unregisterHostHeartbeatHandler();
    clearPeerCrashEndTimer();

    if (noAnswerSweep !== null) {
      clearInterval(noAnswerSweep);
      noAnswerSweep = null;
    }
    clearSetupTimeout();

    if (clientChannel.value) {
      clientChannel.value.close();
      clientChannel.value = null;
    }
    if (hostChannel.value) {
      hostChannel.value.closeAll();
      hostChannel.value = null;
    }

    streams.setHostSignalingChannel(null);
    streams.setClientSignalingChannel(null);
  }

  // ===========================================================================
  // Watchers
  // ===========================================================================

  watch(
    () => starConfig.value,
    newConfig => {
      if (newConfig && ownVA.value && !clientChannel.value && !hostChannel.value) {
        initializeWebRTCChannel();
      }
    },
  );

  watch(
    activePeerVideosForObservation,
    (val, oVal) => {
      if (!ownVA.value) {
        return;
      }

      if (val && val !== oVal) {
        const oldValueAsArray = oVal ? JSON.parse(oVal) : [];
        const valueAsArray = JSON.parse(val);
        const dif = difference(valueAsArray, oldValueAsArray);
        if (!isEmpty(dif)) {
          if (clientChannel.value) {
            clientChannel.value.sendStreamState({
              audio: streams.isMicOn,
              video: streams.isCamOn,
            });
            console.log('[useInCalls] Sent stream state to host for new peers');
          } else if (streams.isHost && streams.hostSignalingChannel) {
            streams.hostSignalingChannel
              .broadcastSignal({
                type: 'stream-state-changed',
                fromAddr: streams.ownAddr,
                data: { audio: streams.isMicOn, video: streams.isCamOn },
              })
              .catch(err => {
                console.error('[useInCalls] Host failed to broadcast stream state for new peers:', err);
              });
            console.log('[useInCalls] Host sent stream state to all clients for new peers');
          }
        }
      }
    },
    {
      immediate: true,
    },
  );

  watch([() => streams.isMicOn, () => streams.isCamOn], ([audio, video]) => {
    if (streams.isClient && clientChannel.value) {
      clientChannel.value.sendStreamState({ audio, video });
      console.log(`[useInCalls] Client stream state changed: audio=${audio}, video=${video}`);
    } else if (streams.isHost && streams.hostSignalingChannel) {
      streams.hostSignalingChannel
        .broadcastSignal({
          type: 'stream-state-changed',
          fromAddr: streams.ownAddr,
          data: { audio, video },
        })
        .catch(err => {
          console.error('[useInCalls] Host failed to broadcast stream state:', err);
        });
      console.log(`[useInCalls] Host stream state changed: audio=${audio}, video=${video}`);
    }
  });

  return {
    t,
    ownName,
    isGroupChat,
    isFullscreen,
    screenShareMode,
    isParticipantListOpen,
    streams,
    peerVideos,
    activePeerVideos,
    connectingPeers,
    activeConnectingPeers,
    waitingPeersCount,
    peerSharedStreams,
    canShareScreen,
    toggleMicStatus,
    toggleCamStatus,
    toggleFullscreen,
    toggleScreenShareMode,
    openScreenShareChoice,
    endCall,
    endCallWhenPeerCloses,
    onPeerConnected,
    doOnMounted,
    doBeforeUnmount,
    // Screen share
    ownScreens,
    isSharingOwnDeskSound,
    removeOwnScreen,
  };
}
