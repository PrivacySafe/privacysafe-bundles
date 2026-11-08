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
 * Streams Store — Star (Host-Client) Architecture Implementation
 *
 * This store manages:
 * - Own media stream (camera/mic)
 * - Chat context (chatId, names, addresses)
 * - Star architecture state (host/client roles)
 * - Remote participants and their streams
 *
 * Star Architecture:
 * - Host (direction: 'outgoing'): Receives streams from all clients, retransmits to others
 * - Client (direction: 'incoming'): Sends own stream to host, receives retransmitted streams
 * - Stream identification via stream.id (equals sender's address)
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { toggleAudioIn, toggleVideoIn } from './utils/utils';
import type { OwnVideoAudio } from '@video/common/types';
import type { ChatIdObj } from '~/asmail-msgs.types';
import type {
  StarConfig,
  StarRole,
  ClientConnectionState,
  HostSignalingChannel,
  ClientSignalingChannel,
} from '@video/common/types/star.types';
import type { ConnectionStatus } from '@video/common/types/peer.types';
import { getVideoQualityConfig } from '@video/common/services/star-constants';
import {
  isScreenShareAddr,
  extractMailerIdFromScreenAddr,
} from '@video/common/services/shared-screen-share';
import { areAddressesEqual, toCanonicalAddress } from '@shared/address-utils';

/**
 * Remote participant info (for UI rendering)
 */
export interface RemoteParticipant {
  addr: string;
  name: string;
  stream: MediaStream | null;
  connectionStatus: ConnectionStatus;
  /** Whether this participant's audio (mic) is muted */
  audioMuted: boolean;
  /** Whether this participant's video (cam) is muted */
  videoMuted: boolean;
  /**
   * Two-phase network-blip hint: set once the participant's link has been
   * reported unstable for longer than the host's reconnect-hint delay
   * (shorter than DISCONNECT_GRACE_MILLIS), so the tile can show a
   * "reconnecting" overlay before it is actually removed.
   */
  reconnecting: boolean;
  /**
   * When this participant entered the roster as 'invited', which is what the
   * "not responding" deadline is counted from (see peersToMarkNoAnswer).
   *
   * The deadline used to be counted from the call view mounting, and that is a
   * different moment on each side: the host mounts it as the invitations go out,
   * while a client mounts it only after the invitation crossed ASMail, rang, and
   * was answered by hand. In the live run of 2026-08-16 the same absent peer was
   * "not responding" on the host and still "Calling…" on the client.
   */
  invitedAt?: number;
}

export const useStreamsStore = defineStore('streams', () => {
  // ===========================================================================
  // Chat Context
  // ===========================================================================

  const chatObjId = ref<Nullable<ChatIdObj>>(null);
  const chatName = ref('');
  const ownName = ref('');
  const ownAddr = ref('');

  /**
   * Identifier of the call session this window serves (see
   * WebRTCMsg.callSessionId), handed over in ChatInfoForCall. Stamped by the
   * signaling channels into every signal they put on ASMail, so the peer can
   * tell a signal of this call from a signal of an earlier one in the same chat.
   * Empty when the call's host runs a build that predates session ids.
   */
  const callSessionId = ref<string | undefined>(undefined);

  /**
   * STUN/TURN configuration of this call, handed over in ChatInfoForCall. This
   * window has no configuration of its own: TURN credentials belong to the
   * background instance, which reads them from a file that can be rotated
   * without rebuilding anything here (see
   * src-deno/services/video-chat-service/ice-config.ts).
   */
  const iceConfig = ref<Nullable<RTCConfiguration>>(null);

  /**
   * Total number of participants in the current call.
   * Used to determine video quality tier.
   * Defaults to 2 (1-on-1) until actual count is known.
   */
  const participantCount = ref<number>(2);

  /** Current video quality configuration based on participant count */
  const videoQualityConfig = computed(() => getVideoQualityConfig(participantCount.value));

  /** Dynamically built media constraints based on participant count */
  const dynamicMediaConstraints = computed(() => {
    const quality = videoQualityConfig.value;
    return {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      } as MediaTrackConstraints,
      video: {
        width: { ideal: quality.resolution.width },
        height: { ideal: quality.resolution.height },
        frameRate: { ideal: quality.framerate },
      } as MediaTrackConstraints,
    };
  });

  // ===========================================================================
  // Own Media State
  // ===========================================================================

  const ownVA = ref<Nullable<OwnVideoAudio>>(null);
  const isMicOn = ref(false);
  const isCamOn = ref(false);

  // ===========================================================================
  // Star Architecture State
  // ===========================================================================

  /** Star configuration (role, host address, RTC config) */
  const starConfig = ref<Nullable<StarConfig>>(null);

  /** Client connection state (only when role === 'client') */
  const clientState = ref<Nullable<ClientConnectionState>>(null);

  /** Map of remote participants (addr -> RemoteParticipant) */
  const remoteParticipants = ref<Map<string, RemoteParticipant>>(new Map());

  /**
   * Roster of participants expected to join the call (from ChatInfoForCall.peers),
   * captured by initialize() and seeded into remoteParticipants (status: 'invited')
   * by initializeStar(), before any signalling happens.
   */
  const expectedPeers = ref<{ addr: string; name: string }[]>([]);

  /**
   * Own connection status to the host, mirrored from clientState.connectionStatus
   * (which is not itself exported) so the UI has a single readable field.
   * Only meaningful when isClient is true.
   */
  const linkStatus = ref<ConnectionStatus>('initializing');

  /**
   * Map of stream ID to sender address.
   * Used when stream.id is a UUID (WebRTC read-only) instead of sender's address.
   * Populated via 'stream-sender-info' system messages from host.
   */
  const streamSenderMap = ref<Map<string, string>>(new Map());

  /**
   * Map of stream/sender address to screen name.
   * Populated via 'stream-sender-info' system messages from host.
   */
  const screenNameMap = ref<Map<string, string>>(new Map());

  /** Pending call direction (set by initialize() for incoming calls) */
  const pendingDirection = ref<'incoming' | 'outgoing' | null>(null);

  /** Pending host address (set by initialize() for incoming calls) */
  const pendingHostAddr = ref<string | null>(null);

  /** Host signaling channel (for receiving signals from clients) */
  const hostSignalingChannel = ref<HostSignalingChannel | null>(null);

  /** Client signaling channel (for sending signals to host) */
  const clientSignalingChannel = ref<ClientSignalingChannel | null>(null);

  // ===========================================================================
  // Computed Properties
  // ===========================================================================

  const isGroupChat = computed(() => chatObjId.value?.isGroupChat);

  /** Is this participant the Host? */
  const isHost = computed(() => starConfig.value?.role === 'host');

  /** Is this participant a Client? */
  const isClient = computed(() => starConfig.value?.role === 'client');

  /** Host address (own address if host, or host's address if client) */
  const hostAddress = computed(() => starConfig.value?.hostAddr ?? null);

  /** Array of remote participants (for UI iteration) */
  const remoteParticipantsList = computed(() =>
    Array.from(remoteParticipants.value.values())
  );

  // ===========================================================================
  // Media Controls
  // ===========================================================================

  function setMicOn(val: boolean): void {
    if (isMicOn.value !== val && ownVA.value) {
      isMicOn.value = val;
      toggleAudioIn(ownVA.value.stream, val);
    }
  }

  function setCamOn(val: boolean): void {
    if (isCamOn.value !== val && ownVA.value) {
      isCamOn.value = val;
      toggleVideoIn(ownVA.value.stream, val);
    }
  }

  function setOwnVAStream(val: Nullable<MediaStream>, videoDevId: Nullable<string>): void {
    if (val) {
      ownVA.value = {
        stream: val,
        deviceId: videoDevId!,
      };
      toggleAudioIn(ownVA.value.stream, isMicOn.value);
      toggleVideoIn(ownVA.value.stream, isCamOn.value);
    } else {
      ownVA.value = null;
    }
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize store with chat context.
   * If direction is 'incoming', immediately initializes as CLIENT.
   */
  function initialize(
    chatId: ChatIdObj,
    chatNom: string,
    ownNom: string,
    ownAddress: string,
    direction?: 'incoming' | 'outgoing',
    hostAddr?: string,
    peers?: { addr: string; name: string }[],
    sessionId?: string,
    rtcConfig?: RTCConfiguration,
  ): void {
    chatObjId.value = chatId;
    chatName.value = chatNom;
    ownName.value = ownNom;
    ownAddr.value = ownAddress;
    expectedPeers.value = peers ?? [];
    callSessionId.value = sessionId;
    iceConfig.value = rtcConfig ?? null;

    // If this is an incoming call, pre-initialize as CLIENT so the UI
    // shows "Join Call" instead of "Start Call".
    if (direction === 'incoming' && hostAddr) {
      console.log(`[StreamsStore] Pre-initializing as CLIENT for incoming call from ${hostAddr}`);
      // We can't call startCall() here because ownVA might not be set yet.
      // Store the direction info so startCall in use-va-setup.ts uses it.
      pendingDirection.value = 'incoming';
      pendingHostAddr.value = hostAddr;
    }
  }

  /**
   * Initialize Star architecture.
   * Called when call starts with determined role.
   *
   * @param config - Star configuration (role, hostAddr, rtcConfig)
   */
  function initializeStar(config: StarConfig): void {
    starConfig.value = config;

    if (config.role === 'host') {
      // The host keeps no per-client state here: the real registry of client
      // connections and their tracks lives in host-channel.ts.
      clientState.value = null;
      console.log(`[StreamsStore] Initialized as HOST (addr: ${config.hostAddr})`);
    } else {
      // Initialize client state
      clientState.value = {
        hostAddr: config.hostAddr,
        peerConnection: null,
        connectionStatus: 'initializing',
        localStream: null,
        remoteStreams: new Map(),
      };
      linkStatus.value = 'initializing';
      console.log(`[StreamsStore] Initialized as CLIENT (host: ${config.hostAddr})`);
    }

    seedExpectedParticipants();
  }

  /**
   * Seed remoteParticipants with the expected roster (from ChatInfoForCall.peers)
   * at status 'invited', so the connecting banner has something to show from the
   * moment the call view mounts, before any signalling has happened.
   */
  function seedExpectedParticipants(): void {
    for (const { addr, name } of expectedPeers.value) {
      if (!addr || isScreenShareAddr(addr) || areAddressesEqual(addr, ownAddr.value)) {
        continue;
      }
      addRemoteParticipant(addr, name || addr.split('@')[0], 'invited');
    }
  }

  // ===========================================================================
  // Remote Participants Management
  // ===========================================================================

  /**
   * Buffer for stream states (mic/cam) that arrive BEFORE the participant
   * is created in the store. Without this buffer, 'stream-state-changed'
   * signals received before ontrack/stream-sender-info would be lost and
   * the mute indicators would show incorrect state.
   */
  const pendingStreamStates = new Map<string, { audio: boolean; video: boolean }>();

  /**
   * Applies a buffered stream state (if any) to a just-created participant.
   */
  function applyPendingStreamState(addr: string): void {
    const pending = pendingStreamStates.get(addr);
    if (!pending) {
      return;
    }
    const participant = remoteParticipants.value.get(addr);
    if (participant) {
      pendingStreamStates.delete(addr);
      participant.audioMuted = !pending.audio;
      participant.videoMuted = !pending.video;
      console.log(`[StreamsStore] Applied buffered stream state for ${addr}: audio=${pending.audio}, video=${pending.video}`);
    }
  }

  /**
   * Resolves `addr` to the key it is (or should be) stored under in
   * remoteParticipants. Falls back to `addr` itself when there is no exact
   * match and either `addr` is a screen-share pseudo-address or not a real
   * mailerId address (e.g. a WebRTC-assigned UUID stream id) — in both cases
   * canonicalization does not apply.
   *
   * Needed because the roster seeded from the chat DB (ChatInfoForCall.peers)
   * and the address seen on incoming ASMail signals may differ in
   * case/whitespace; without reconciliation the same peer would end up as
   * two separate (one permanently stuck) entries.
   */
  function keyFor(addr: string): string {
    if (remoteParticipants.value.has(addr) || isScreenShareAddr(addr)) {
      return addr;
    }
    try {
      const canon = toCanonicalAddress(addr);
      for (const key of remoteParticipants.value.keys()) {
        if (isScreenShareAddr(key)) {
          continue;
        }
        if (toCanonicalAddress(key) === canon) {
          return key;
        }
      }
    } catch {
      // Not an address (e.g. a UUID stream id) — fall through.
    }
    return addr;
  }

  /**
   * Look up a remote participant, reconciling address-key mismatches via keyFor().
   */
  function getParticipant(addr: string): RemoteParticipant | undefined {
    return remoteParticipants.value.get(keyFor(addr));
  }

  /**
   * Whether `addr` is the host of this call. A screen share's address is
   * `screen:<owner>:<srcId>`, never equal to the owner's, so a shared screen is
   * not taken for the host's camera.
   */
  function isHostAddr(addr: string): boolean {
    const host = hostAddress.value;
    return !!host && areAddressesEqual(addr, host);
  }

  /**
   * Add or update a remote participant.
   */
  function addRemoteParticipant(addr: string, name: string, status: ConnectionStatus = 'connecting'): void {
    const existing = remoteParticipants.value.get(keyFor(addr));
    if (!existing) {
      remoteParticipants.value.set(addr, {
        addr,
        name,
        stream: null,
        connectionStatus: status,
        audioMuted: false,
        videoMuted: false,
        reconnecting: false,
        ...((status === 'invited') ? { invitedAt: Date.now() } : {}),
      });
      console.log(`[StreamsStore] Added remote participant: ${name} (${addr}), status=${status}`);
      applyPendingStreamState(addr);
    }
  }

  /**
   * Update remote participant's stream.
   * Called when ontrack event fires.
   */
  function updateRemoteStream(addr: string, stream: MediaStream): void {
    const key = keyFor(addr);
    const participant = remoteParticipants.value.get(key);
    // Deliberately NOT touching connectionStatus here: a track arrives with
    // setRemoteDescription, long before ICE/DTLS succeed, and stamping
    // 'connected' from it cleared the 1-1 setup watchdog and hid the
    // connecting banner while RTP had not (and sometimes never) started.
    // The honest 'connected' comes from the real connectionState callbacks.
    if (participant) {
      participant.stream = stream;
      // The `reconnecting` hint, however, IS settled by media: tracks arriving
      // from a peer are proof that the link the hint doubted is alive. Nothing
      // else is guaranteed to take the hint off — a fulfilled re-join
      // announcement is withdrawn by nobody (see clearRejoinNotice in
      // host-channel.ts), and a lost `reconnecting: false` has no resend — so
      // without this a peer's live video plays on under a blur that says they
      // are reconnecting (run of 2026-08-16, twice).
      participant.reconnecting = false;
      console.log(`[StreamsStore] Updated stream for ${key}`);
    } else {
      // Participant not yet added, create with stream
      remoteParticipants.value.set(addr, {
        addr,
        name: addr, // Will be updated when name is known
        stream,
        connectionStatus: 'establishing',
        audioMuted: false,
        videoMuted: false,
        reconnecting: false,
      });
      console.log(`[StreamsStore] Created participant with stream: ${addr}`);
      applyPendingStreamState(addr);
    }
  }

  /**
   * Update remote participant's connection status.
   */
  function updateRemoteStatus(addr: string, status: ConnectionStatus): void {
    const participant = remoteParticipants.value.get(keyFor(addr));
    if (participant) {
      participant.connectionStatus = status;
    }
  }

  /**
   * Update remote participant's stream state (mic/cam muted status).
   * Called when a 'stream-state-changed' signal is received.
   */
  function updateParticipantStreamState(addr: string, state: { audio: boolean; video: boolean }): void {
    const key = keyFor(addr);
    const participant = remoteParticipants.value.get(key);
    if (participant) {
      participant.audioMuted = !state.audio;
      participant.videoMuted = !state.video;
      console.log(`[StreamsStore] Updated stream state for ${key}: audio=${state.audio}, video=${state.video}`);
    } else {
      // Participant not created yet (tracks/sender-info may still be in
      // flight) — buffer the state to apply once the participant appears.
      pendingStreamStates.set(addr, { ...state });
      console.log(`[StreamsStore] Buffered stream state for not-yet-known participant ${addr}: audio=${state.audio}, video=${state.video}`);
    }
  }

  /**
   * Sets the two-phase network-blip hint for a remote participant.
   * Called on a 'participant-reconnecting' signal (relayed by the host for
   * another client) or for the client's own link status toward the host.
   */
  function setParticipantReconnecting(addr: string, reconnecting: boolean): void {
    const participant = remoteParticipants.value.get(keyFor(addr));
    if (participant) {
      participant.reconnecting = reconnecting;
    }
  }

  /**
   * Remove a remote participant.
   * Called when participant leaves the call.
   *
   * When a real (non-screen) peer leaves, also cascade-remove their
   * screen-share pseudo-participants (`screen:${addr}:*`) so a crash/abnormal
   * exit cannot leave a frozen screen-share tile.
   */
  function removeRemoteParticipant(addr: string): void {
    const key = keyFor(addr);

    // Cascade: owner leave → drop all owned screen shares first (idempotent).
    if (!isScreenShareAddr(key)) {
      const ownedScreens: string[] = [];
      for (const k of remoteParticipants.value.keys()) {
        if (isScreenShareAddr(k) && extractMailerIdFromScreenAddr(k) === key) {
          ownedScreens.push(k);
        }
      }
      for (const screenAddr of ownedScreens) {
        console.log(
          `[StreamsStore] Cascading remove of screen share ${screenAddr} (owner ${key} left)`,
        );
        removeRemoteParticipant(screenAddr);
      }
    } else {
      screenNameMap.value.delete(key);
    }

    // Dropping the record is the whole job: these are receiver tracks owned by
    // the peer connection, not ours to end. Stopping one killed it for good
    // while its transceiver lived on, so whatever the sender put on that
    // m-line next reached us already ended - a tile with the right name and no
    // picture. The tracks die with their transceiver, as they should.
    const participant = remoteParticipants.value.get(key);
    if (participant) {
      remoteParticipants.value.delete(key);
      console.log(`[StreamsStore] Removed remote participant: ${key}`);
      // Only alongside a participant that actually existed. A departure is
      // repeated blindly over a minute, so a duplicate 'participant-left' lands
      // routinely with nothing left to remove — and it used to discard the
      // state buffered for a participant that has not appeared YET. That is how
      // a peer who muted while re-joining came back with no mute indicator: its
      // fresh state was buffered, a late copy of its own old departure wiped
      // the buffer, and the tile was then created with nothing to apply.
      // The trade-off: a state buffered for a peer who never appears at all now
      // outlives their departure. One entry per address, bounded by the roster,
      // and it only ever applies if that address comes back — where a fresh
      // state follows anyway.
      pendingStreamStates.delete(key);
    }

    // Also clean up stream-id mappings pointing to this participant and
    // remove any UUID-keyed participants that belong to it (these can exist
    // if tracks arrived before 'stream-sender-info' and timed out).
    for (const [streamId, sender] of streamSenderMap.value.entries()) {
      if (sender === key) {
        streamSenderMap.value.delete(streamId);
        const orphan = remoteParticipants.value.get(streamId);
        if (orphan) {
          remoteParticipants.value.delete(streamId);
          console.log(`[StreamsStore] Removed orphan participant keyed by stream id: ${streamId}`);
        }
      }
    }
  }

  /**
   * Update stream ID to sender address mapping.
   * Called when 'stream-sender-info' system message is received from host.
   * This is needed because WebRTC stream.id is read-only and may be a UUID.
   */
  function updateStreamSenderMapping(streamId: string, senderAddr: string, screenName?: string): void {
    streamSenderMap.value.set(streamId, senderAddr);
    if (screenName) {
      screenNameMap.value.set(senderAddr, screenName);
    }
    console.log(`[StreamsStore] Stream sender mapping: ${streamId} -> ${senderAddr}`);

    // If we have a participant with this stream ID as addr, update it
    const participant = remoteParticipants.value.get(streamId);
    if (participant && participant.addr !== senderAddr) {
      // Remove old entry and create new one with correct address
      remoteParticipants.value.delete(streamId);
      participant.addr = senderAddr;
      if (senderAddr.startsWith('screen:')) {
        const owner = senderAddr.split(':')[1] || senderAddr;
        const ownerShort = owner.split('@')[0] || owner;
        participant.name = screenName ? `${ownerShort} ${screenName}` : `${ownerShort} screen`;
      } else {
        participant.name = senderAddr.split('@')[0] || senderAddr;
      }
      remoteParticipants.value.set(senderAddr, participant);
      console.log(`[StreamsStore] Updated participant address from ${streamId} to ${senderAddr}`);
      applyPendingStreamState(senderAddr);
    } else if (screenName && senderAddr.startsWith('screen:')) {
      const existing = remoteParticipants.value.get(senderAddr);
      if (existing) {
        const owner = senderAddr.split(':')[1] || senderAddr;
        const ownerShort = owner.split('@')[0] || owner;
        existing.name = `${ownerShort} ${screenName}`;
      }
    }
  }

  /**
   * Resolve sender address from stream ID.
   * Returns the mapped sender address if available, otherwise returns the stream ID itself.
   */
  function resolveStreamSender(streamId: string): string {
    return streamSenderMap.value.get(streamId) || streamId;
  }

  // ===========================================================================
  // Host-Specific Methods
  // ===========================================================================

  // ===========================================================================
  // Client-Specific Methods
  // ===========================================================================

  /**
   * Update client connection state.
   */
  function updateClientConnectionStatus(status: ConnectionStatus): void {
    if (clientState.value) {
      clientState.value.connectionStatus = status;
      linkStatus.value = status;
      console.log(`[StreamsStore] Client connection status: ${status}`);
    }
  }

  /**
   * Clear all remote participant tiles after the client↔host link fails.
   * Stops tracks so video elements do not keep a frozen last frame.
   * Does not end the whole call session (user may still see own camera / UI).
   */
  function clearRemoteParticipantsOnLinkFailure(): void {
    const addrs = [...remoteParticipants.value.keys()];
    for (const addr of addrs) {
      removeRemoteParticipant(addr);
    }
    streamSenderMap.value.clear();
    pendingStreamStates.clear();
    console.log('[StreamsStore] Cleared remote participants after link failure');
  }

  // ===========================================================================
  // Call Lifecycle
  // ===========================================================================

  /**
   * Start call — initializes Star architecture based on direction.
   *
   * @param direction - 'outgoing' for host, 'incoming' for client (default: 'outgoing')
   * @param hostAddr - Host address (own address if host, sender's address if client)
   */
  function startCall(direction: 'outgoing' | 'incoming' = 'outgoing', hostAddr?: string): void {
    if (!ownVA.value) {
      throw new Error(`Own stream is not set`);
    }
    // There is deliberately no built-in fallback: an ICE configuration is what
    // the background instance hands over in ChatInfoForCall, and a window that
    // carried its own copy would put TURN credentials into its bundle.
    if (!iceConfig.value) {
      throw new Error(`ICE configuration of this call is not set`);
    }

    // Determine role based on direction
    const role: StarRole = direction === 'outgoing' ? 'host' : 'client';

    // Use own address as host address if not provided (for host role)
    const resolvedHostAddr = hostAddr ?? ownAddr.value;

    // Initialize Star architecture
    initializeStar({
      role,
      hostAddr: resolvedHostAddr,
      rtcConfig: iceConfig.value,
    });

    // Store local stream in client state
    if (clientState.value) {
      clientState.value.localStream = ownVA.value.stream;
    }

    console.log(`[StreamsStore] startCall() — role: ${role}, host: ${resolvedHostAddr}`);
  }

  /**
   * End call — cleanup all connections and streams.
   */
  async function endCall(): Promise<void> {
    console.log('[StreamsStore] endCall() — cleaning up...');

    // Nothing to close on the host side here: client connections belong to
    // host-channel.ts, whose closeAll() the call teardown invokes.

    // Close client connection
    if (clientState.value?.peerConnection) {
      clientState.value.peerConnection.close();
      console.log('[StreamsStore] Closed connection to host');
      clientState.value = null;
    }

    // Clear remote participants
    for (const [addr] of remoteParticipants.value) {
      removeRemoteParticipant(addr);
    }

    // Stop local tracks (camera/mic)
    if (ownVA.value) {
      ownVA.value.stream.getTracks().forEach(track => track.stop());
    }

    // Reset Star config
    starConfig.value = null;

    console.log('[StreamsStore] endCall() — cleanup complete');
  }

  // ===========================================================================
  // Signaling Channel Management
  // ===========================================================================

  /**
   * Set the host signaling channel.
   * Called by use-in-calls.ts when host channel is initialized.
   */
  function setHostSignalingChannel(channel: HostSignalingChannel | null): void {
    hostSignalingChannel.value = channel;
    console.log(`[StreamsStore] Host signaling channel ${channel ? 'set' : 'cleared'}`);
  }

  /**
   * Set the client signaling channel.
   * Called by use-in-calls.ts when client channel is initialized.
   */
  function setClientSignalingChannel(channel: ClientSignalingChannel | null): void {
    clientSignalingChannel.value = channel;
    console.log(`[StreamsStore] Client signaling channel ${channel ? 'set' : 'cleared'}`);
  }

  // ===========================================================================
  // Return Store Interface
  // ===========================================================================

  return {
    // Chat context
    chatObjId,
    chatName,
    ownName,
    ownAddr,
    callSessionId,
    isGroupChat,

    // Own media
    ownVA,
    isMicOn,
    isCamOn,

    // Participant count (for video quality)
    participantCount,
    videoQualityConfig,
    dynamicMediaConstraints,

    // Media controls
    setMicOn,
    setCamOn,
    setOwnVAStream,

    // Star architecture state
    starConfig,
    remoteParticipants,
    remoteParticipantsList,

    // Star computed
    isHost,
    isClient,
    hostAddress,

    // Pending call info (for incoming calls)
    pendingDirection,
    pendingHostAddr,

    // Expected roster / own link status (for the connecting banner)
    expectedPeers,
    linkStatus,
    seedExpectedParticipants,
    getParticipant,
    isHostAddr,

    // Signaling channels
    hostSignalingChannel,
    clientSignalingChannel,
    setHostSignalingChannel,
    setClientSignalingChannel,

    // Initialization
    initialize,

    // Remote participants
    addRemoteParticipant,
    updateRemoteStream,
    updateRemoteStatus,
    updateParticipantStreamState,
    setParticipantReconnecting,
    removeRemoteParticipant,

    // Stream sender mapping (for UUID stream IDs)
    updateStreamSenderMapping,
    resolveStreamSender,

    // Screen name mapping (screen share display names)
    screenNameMap,

    // Host methods

    // Client methods
    updateClientConnectionStatus,
    clearRemoteParticipantsOnLinkFailure,

    // Call lifecycle
    startCall,
    endCall,
  };
});

export type StreamsStore = ReturnType<typeof useStreamsStore>;
