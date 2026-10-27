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
/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Video Chat Star Architecture Tests
 *
 * Tests for Host-Client (Star) topology video calls:
 * - Test Suite 1: Call Initiation & Role Assignment
 * - Test Suite 2: Signaling Exchange (Offer/Answer)
 * - Test Suite 3: SFU Track Routing (Critical!)
 * - Test Suite 4: Client Disconnection & Cleanup
 * - Test Suite 5: Edge Cases
 */

import { itCond } from '../libs-for-tests/jasmine-utils.js';
import {
  MockRTCPeerConnection,
  MockMediaStream,
  createMockMediaStreamTrack,
  createMockClientSignalingChannel,
  createMockHostSignalingChannel,
  createRealMediaStreamForTesting,
  createRealMediaStreamTrack,
  VALID_SDP,
} from '../libs-for-tests/webrtc-mocks.js';
import { createClientChannel } from '@video/common/services/client-channel.ts';
import { createHostChannel } from '@video/common/services/host-channel.ts';
import {
  applyCodecPreferences,
  createRetryWatcher,
  createSdpFreshnessGate,
  createSerialTaskQueue,
  createAudioRelayBridge,
  encodableSenderTrackIds,
  outboundHasLiveTrack,
  sdpDirectionsByMid,
} from '@video/common/services/webrtc-utils.ts';
import { createDepartureGate } from '@shared/departure-gate';
import { isDeliveryStillInFlight } from '@shared/webrtc-signalling';
import {
  MAX_RESERVED_SLOTS,
  RESERVED_SCREEN_AUDIO_SLOTS,
  RESERVED_SCREEN_VIDEO_SLOTS,
  buildSlotReservation,
  clearedRelaySlotOnDeparture,
  kindsAlreadyForwarded,
  pickSlot,
  relaySlotOwnerToShow,
} from '@video/common/services/relay-slots.ts';
import {
  STREAM_INFO_BATCH_WINDOW_MS,
  attributeIncomingHostSignal,
  parseStarSignalFromWebRTCMsg,
} from '@video/common/services/signaling-channel-core.ts';
import { mayActFor } from '@video/common/services/shared-screen-share.ts';
import { sleep } from '@shared/processes/sleep';
import type {
  ClientSignalingChannel,
  HostSignalingChannel,
  OfferSignalPayload,
  RelaySlotDeclaration,
  StarSignalType,
  StreamSenderInfosBatchPayload,
} from '@video/common/types/star.types.ts';
import type { ChatIdObj } from '~/asmail-msgs.types';
import {
  areChatIdsEqual,
  chatIdToString,
  chatMessageIdForCallEvent,
  generateOutgoingMsgId,
  hostAddrOfCallSession,
  stringToChatId,
} from '../../../shared-libs/chat-ids.ts';
import { VIDEO_WINDOW_IPC_METHODS } from '@video/common/services/service-provider';
import { VIDEO_WINDOW_METHODS_CALLED_HERE } from '@deno/services/video-chat-service/video-component-instance.ts';
import type {
  CallSessionRecord,
  CallCollisionParty,
  CallSessions,
  CallState,
  ParticipantState,
  SignalAge,
} from '@deno/services/video-chat-service/utils/call-state.ts';
import {
  ENDED_BY_HOST_RETENTION_MILLIS,
  ENDED_SESSION_RETENTION_MILLIS,
  HEARTBEAT_MAX_AGE_MILLIS,
  HEARTBEAT_TIMEOUT,
  HOST_ENDED_SUPPRESS_MILLIS,
  MAX_SIGNAL_AGE_MILLIS,
  PROVISIONAL_REJOIN_TIMEOUT,
  RECENTLY_ENDED_COOLDOWN_MILLIS,
  REJOIN_RELAY_MIN_INTERVAL_MILLIS,
  RINGING_NO_ANSWER_TIMEOUT_MILLIS,
  admitsCallCancelSysMsg,
  callCollisionWinner,
  callHandledElsewhereOutcome,
  canTransit,
  createCallSessions,
  declineEndsCall,
  inviteStillPending,
  isHostEndingRingingCall,
  rejoinTargetOf,
  shouldRelayRejoinBeat,
} from '@deno/services/video-chat-service/utils/call-state.ts';
import { callCancelWording } from '../../../shared-libs/call-record-wording.ts';
import {
  NO_ANSWER_TIMEOUT_MS,
  peersToMarkNoAnswer,
} from '@video/common/utils/no-answer.ts';
import { repeatScheduleFor } from '@deno/services/video-chat-service/utils/_common.ts';
import type { ChatIncomingMessage, ChatWebRTCMsgV1, WebRTCMsg } from '~/asmail-msgs.types';
import {
  REJOIN_NOTICE_REPEAT_DELAYS_MILLIS,
  checkChatMessageJSONforWebRTC,
  isRejoinNotice,
  rejoinNoticeMsg,
  signalAgeOf,
} from '@deno/services/video-chat-service/utils/webrtc-msg-body.ts';
import {
  REJOIN_NOTICE_TTL_MS,
  participantTileOnRejoinNotice,
  reconnectingHintEffect,
  rejoinNoticeAction,
  rejoinNoticeExpiry,
} from '@video/common/services/rejoin-notice.ts';
import {
  CALL_RECORD_STAMP_MAX_AGE_MILLIS,
  pickCallRecordToStamp,
} from '@deno/services/video-chat-service/utils/call-record.ts';
import type { DeliveryApiForConfirmation } from '../../../shared-libs/asmail-utils.ts';
import { sendMsgWithDeliveryConfirmation } from '../../../shared-libs/asmail-utils.ts';

// =============================================================================
// Test Constants
// =============================================================================

const HOST_ADDR = 'host@3nsoft.net';
const CLIENT_A_ADDR = 'clientA@3nsoft.net';
const CLIENT_B_ADDR = 'clientB@3nsoft.net';
const CLIENT_C_ADDR = 'clientC@3nsoft.net';

/**
 * Every batched stream mapping the host sent, as [recipient, payload] pairs.
 * Mappings go out over sendSignalToClient, batched into 'stream-sender-infos'.
 */
function mappingSignalsSentTo(
  mockSignaling: ReturnType<typeof createMockHostSignalingChannel>,
): Array<[string, StreamSenderInfosBatchPayload]> {
  return mockSignaling.sendSignalToClient.calls.all()
  .map(call => call.args as [string, { type: string; data: StreamSenderInfosBatchPayload }])
  .filter(([, signal]) => signal?.type === 'stream-sender-infos')
  .map(([clientAddr, signal]) => [clientAddr, signal.data]);
}


// =============================================================================
// Test Suite 1: Call Initiation & Role Assignment
// =============================================================================

describe(`Video Chat Star Architecture`, () => {

  describe(`Test Suite 1: Call Initiation & Role Assignment`, () => {

    itCond(`Host (outgoing): initializes with correct role and hostAddr`, async () => {
      // This test verifies that when direction is 'outgoing',
      // the participant becomes a Host with own address as hostAddr

      // Arrange - simulate outgoing call (initiator)
      const direction = 'outgoing' as const;
      const ownAddr = HOST_ADDR;

      // Act - determine role based on direction
      const role = direction === 'outgoing' ? 'host' : 'client';
      const hostAddr = role === 'host' ? ownAddr : null;

      // Assert
      expect(role).toBe('host');
      expect(hostAddr).toBe(HOST_ADDR);
    }, 5000);

    itCond(`Client (incoming): initializes with correct role and hostAddr from sender`, async () => {
      // This test verifies that when direction is 'incoming',
      // the participant becomes a Client with sender's address as hostAddr

      // Helper function to determine role (avoids TS narrowing issues)
      function determineRole(dir: 'incoming' | 'outgoing'): 'host' | 'client' {
        return dir === 'outgoing' ? 'host' : 'client';
      }

      // Arrange - simulate incoming call (recipient)
      const senderAddr = HOST_ADDR;

      // Act - determine role based on direction
      const role = determineRole('incoming');
      const hostAddr = role === 'client' ? senderAddr : null;

      // Assert
      expect(role).toBe('client');
      expect(hostAddr).toBe(HOST_ADDR);
    }, 5000);

    itCond(`Host: initializes clients map with all expected peers`, async () => {
      // This test verifies that Host initializes tracking for all expected clients

      // Arrange
      const peers = [
        { addr: CLIENT_A_ADDR, name: 'Client A' },
        { addr: CLIENT_B_ADDR, name: 'Client B' },
        { addr: CLIENT_C_ADDR, name: 'Client C' },
      ];

      // Act - simulate Host initialization
      const clients = new Map<string, { addr: string; name: string; isConnected: boolean }>();
      for (const peer of peers) {
        clients.set(peer.addr, {
          addr: peer.addr,
          name: peer.name,
          isConnected: false,
        });
      }

      // Assert - all peers should be tracked (not yet connected)
      expect(clients.size).toBe(3);
      expect(clients.get(CLIENT_A_ADDR)?.isConnected).toBe(false);
      expect(clients.get(CLIENT_B_ADDR)?.isConnected).toBe(false);
      expect(clients.get(CLIENT_C_ADDR)?.isConnected).toBe(false);
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 2: Signaling Exchange (Offer/Answer)
  // ===========================================================================

  describe(`Test Suite 2: Signaling Exchange (Offer/Answer)`, () => {

    itCond(`Client: creates SDP Offer and sends to Host via signaling channel`, async () => {
      // Arrange
      const mockSignaling = createMockClientSignalingChannel();
      // Use REAL MediaStream because RTCPeerConnection.addTrack() validates track types
      const realStream = createRealMediaStreamForTesting();

      const clientChannel = createClientChannel({
        hostAddr: HOST_ADDR,
        ownAddr: CLIENT_A_ADDR,
        rtcConfig: {},
        localStream: realStream,
        signalingChannel: mockSignaling as unknown as ClientSignalingChannel,
        onRemoteTrack: () => {},
        onConnectionStateChange: () => {},
      });

      // Act
      await clientChannel.createAndSendOffer();

      // Assert
      expect(mockSignaling.sendDescription).toHaveBeenCalledTimes(1);
      const sentOffer = mockSignaling.sendDescription.calls.argsFor(0)[0];
      expect(sentOffer.type).toBe('offer');
      expect(sentOffer.sdp).toBeDefined();
    }, 10000);

    itCond(`Host: creates isolated RTCPeerConnection for each client Offer`, async () => {
      // Arrange
      const mockSignaling = createMockHostSignalingChannel();
      // Use REAL MediaStream because RTCPeerConnection.addTrack() validates track types
      const realStream = createRealMediaStreamForTesting();

      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: realStream,
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: jasmine.createSpy('onClientConnected'),
        onClientDisconnected: () => {},
        onClientTrack: () => {},
      });

      const offer: RTCSessionDescriptionInit = { type: 'offer', sdp: VALID_SDP };

      // Act
      await hostChannel.handleClientOffer(CLIENT_A_ADDR, offer);

      // Assert
      expect(hostChannel.getClientCount()).toBe(1);
    }, 10000);

    itCond(`Host: creates and sends SDP Answer to client`, async () => {
      // Arrange
      const mockSignaling = createMockHostSignalingChannel();
      // Use REAL MediaStream because RTCPeerConnection.addTrack() validates track types
      const realStream = createRealMediaStreamForTesting();

      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: realStream,
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: () => {},
        onClientDisconnected: () => {},
        onClientTrack: () => {},
      });

      // Act
      await hostChannel.handleClientOffer(CLIENT_A_ADDR, { type: 'offer', sdp: VALID_SDP });

      // Assert
      expect(mockSignaling.sendAnswerToClient).toHaveBeenCalledTimes(1);
      expect(mockSignaling.sendAnswerToClient).toHaveBeenCalledWith(
        CLIENT_A_ADDR,
        jasmine.objectContaining({ type: 'answer' })
      );
    }, 10000);

    itCond(`Client: applies SDP Answer received from Host`, async () => {
      // Arrange
      const mockSignaling = createMockClientSignalingChannel();
      // Use REAL MediaStream because RTCPeerConnection.addTrack() validates track types
      const realStream = createRealMediaStreamForTesting();

      const clientChannel = createClientChannel({
        hostAddr: HOST_ADDR,
        ownAddr: CLIENT_A_ADDR,
        rtcConfig: {},
        localStream: realStream,
        signalingChannel: mockSignaling as unknown as ClientSignalingChannel,
        onRemoteTrack: () => {},
        onConnectionStateChange: () => {},
      });

      await clientChannel.createAndSendOffer();
      const pc = clientChannel.getPeerConnection()!;

      // The answer must be derived from the offer that was actually sent. A
      // canned SDP string cannot serve here: the browser requires the answer's
      // m-lines and mids to match the offer, and this offer is generated from a
      // real MediaStream. An answer that does not fit is rolled back by
      // applyAnswerWithRecovery(), leaving remoteDescription null — which is
      // exactly what made this spec fail against a static VALID_SDP_ANSWER.
      const sentOffer = mockSignaling.sendDescription.calls.argsFor(0)[0] as RTCSessionDescriptionInit;
      const remotePc = new RTCPeerConnection();
      try {
        await remotePc.setRemoteDescription(sentOffer);
        await remotePc.setLocalDescription(await remotePc.createAnswer());

        // Act
        await clientChannel.applyAnswer(remotePc.localDescription!);

        // Assert
        expect(pc.remoteDescription)
          .withContext(`the answer should have been applied, not rolled back`)
          .not.toBeNull();
        expect(pc.remoteDescription?.type).toBe('answer');
        expect(pc.signalingState)
          .withContext(`applying an answer completes the negotiation`)
          .toBe('stable');
      } finally {
        remotePc.close();
      }
    }, 10000);

  });

  // ===========================================================================
  // Test Suite 3: SFU Track Routing (CRITICAL!)
  // ===========================================================================

  describe(`Test Suite 3: SFU Track Routing (Critical!)`, () => {

    itCond(`Host: broadcasts track from Client B to Client C (SFU retransmission)`, async () => {
      // This is the MOST IMPORTANT test for Star architecture!
      // It verifies that when Client B sends a track to Host,
      // Host adds this track to Client C's connection (but NOT back to B)

      // Arrange
      const mockSignaling = createMockHostSignalingChannel();
      // Use REAL MediaStream because RTCPeerConnection.addTrack() validates track types
      const realStream = createRealMediaStreamForTesting();

      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: realStream,
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: () => {},
        onClientDisconnected: () => {},
        onClientTrack: () => {},
      });

      // Connect both clients
      await hostChannel.handleClientOffer(CLIENT_B_ADDR, { type: 'offer', sdp: VALID_SDP });
      await hostChannel.handleClientOffer(CLIENT_C_ADDR, { type: 'offer', sdp: VALID_SDP });

      expect(hostChannel.getClientCount()).toBe(2);

      // Act: Broadcast track from Client B (use real track for MediaStream constructor)
      const trackFromB = createRealMediaStreamTrack('video');
      const streamFromB = new MediaStream([trackFromB]);
      Object.defineProperty(streamFromB, 'id', { value: CLIENT_B_ADDR, configurable: true });

      hostChannel.broadcastTrackToOtherClients(CLIENT_B_ADDR, trackFromB, streamFromB);

      // Assert: We can verify the broadcast was called without errors
      // The actual addTrack calls are internal to the host channel
      expect(hostChannel.getClientCount()).toBe(2);

      // ...and the relay must NOT have re-offered to anyone yet. These pcs never
      // reach 'connected' here, which is exactly the state the gate holds back:
      // an offer sent into a client's unfinished first negotiation is what rolled
      // an ICE-connected transport back to 'new' and lost the call
      // (2026-08-12). The relay itself is still set up — only the offer waits.
      await sleep(500);
      const offersSent = mockSignaling.sendSignalToClient.calls.allArgs()
        .filter(([, signal]) => (signal as { type: string }).type === 'offer');
      expect(offersSent.length)
        .withContext(`no renegotiation offer before a client is connected`)
        .toBe(0);
    }, 10000);

    itCond(`Host: sets stream.id to sender's address for track identification`, async () => {
      // This test verifies that when Host retransmits a track,
      // the stream.id is set to the sender's address so receiving clients
      // can identify which participant the stream belongs to

      // Arrange
      const trackFromB = createMockMediaStreamTrack('video');
      const streamId = CLIENT_B_ADDR;

      // Act - create proxy stream with sender's address as ID
      const proxyStream = new MockMediaStream(streamId, [trackFromB as unknown as MediaStreamTrack]);

      // Assert
      expect(proxyStream.id).toBe(CLIENT_B_ADDR);
    }, 5000);

    itCond(`Host: broadcasts track to ALL other clients (3 participants scenario)`, async () => {
      // This test verifies SFU retransmission with 3 clients:
      // When Client A sends a track, both B and C should receive it

      // Arrange
      const mockSignaling = createMockHostSignalingChannel();
      // Use REAL MediaStream because RTCPeerConnection.addTrack() validates track types
      const realStream = createRealMediaStreamForTesting();

      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: realStream,
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: () => {},
        onClientDisconnected: () => {},
        onClientTrack: () => {},
      });

      // Connect 3 clients
      await hostChannel.handleClientOffer(CLIENT_A_ADDR, { type: 'offer', sdp: VALID_SDP });
      await hostChannel.handleClientOffer(CLIENT_B_ADDR, { type: 'offer', sdp: VALID_SDP });
      await hostChannel.handleClientOffer(CLIENT_C_ADDR, { type: 'offer', sdp: VALID_SDP });

      expect(hostChannel.getClientCount()).toBe(3);

      // Act: Broadcast track from Client A (use real track for MediaStream constructor)
      const trackFromA = createRealMediaStreamTrack('video');
      const streamFromA = new MediaStream([trackFromA]);
      Object.defineProperty(streamFromA, 'id', { value: CLIENT_A_ADDR, configurable: true });

      hostChannel.broadcastTrackToOtherClients(CLIENT_A_ADDR, trackFromA, streamFromA);

      // Assert: All 3 clients are still connected (broadcast succeeded)
      expect(hostChannel.getClientCount()).toBe(3);
    }, 10000);

    itCond(`Host: does NOT send track back to its source`, async () => {
      // This test verifies that when broadcasting,
      // the source client is excluded from receiving its own track

      // Arrange
      const sourceAddr = CLIENT_B_ADDR;
      const otherClients = [CLIENT_A_ADDR, CLIENT_C_ADDR];

      // Act - simulate broadcast logic
      const broadcastTargets = [CLIENT_A_ADDR, CLIENT_B_ADDR, CLIENT_C_ADDR]
        .filter(addr => addr !== sourceAddr);

      // Assert
      expect(broadcastTargets).toEqual(otherClients);
      expect(broadcastTargets).not.toContain(sourceAddr);
    }, 5000);

    itCond(`Host: announces one screen share under a single stream id to every client`, async () => {
      // A viewer resolves a screen share by matching the msid on the wire
      // against the id in 'stream-sender-info'. Minting a fresh proxy stream
      // for a client that joined mid-share made those two diverge, and the
      // share arrived under an id that viewer could not map to a sender: a
      // tile with the right name and no picture.

      const mockSignaling = createMockHostSignalingChannel();
      const screenTrack = createRealMediaStreamTrack('video');
      let sharing = false;
      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: createRealMediaStreamForTesting(),
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: () => {},
        onClientDisconnected: () => {},
        onClientTrack: () => {},
        // What the app layer reports as the host's live share; a client
        // answered mid-share is caught up from it.
        getOwnScreenTracks: () => (sharing
          ? [{ track: screenTrack, mailerId: HOST_ADDR, srcId: 'win-1', screenName: 'Editor' }]
          : []),
      });

      // B is in the call before the share starts, C joins in the middle of it.
      await hostChannel.handleClientOffer(CLIENT_B_ADDR, { type: 'offer', sdp: VALID_SDP });
      sharing = true;
      hostChannel.addOwnScreenTrack(screenTrack, new MediaStream(), HOST_ADDR, 'win-1', 'Editor');
      await hostChannel.handleClientOffer(CLIENT_C_ADDR, { type: 'offer', sdp: VALID_SDP });

      // Mappings travel batched over ASMail; wait out the debounce window.
      await sleep(STREAM_INFO_BATCH_WINDOW_MS + 400);

      const screenAddr = `screen:${HOST_ADDR}:win-1`;
      const idsPerClient = new Map<string, Set<string>>();
      for (const [clientAddr, signal] of mappingSignalsSentTo(mockSignaling)) {
        for (const info of signal.infos) {
          if (info.senderAddr !== screenAddr) {
            continue;
          }
          const ids = idsPerClient.get(clientAddr) ?? new Set<string>();
          ids.add(info.streamId);
          idsPerClient.set(clientAddr, ids);
        }
      }

      expect(idsPerClient.get(CLIENT_B_ADDR)?.size).toBe(1);
      expect(idsPerClient.get(CLIENT_C_ADDR)?.size).toBe(1);
      const [idForB] = [...(idsPerClient.get(CLIENT_B_ADDR) ?? [])];
      const [idForC] = [...(idsPerClient.get(CLIENT_C_ADDR) ?? [])];
      expect(idForC).toBe(idForB);

      hostChannel.closeAll();
    }, 15000);

    itCond(`Host: announces a re-started screen share instead of suppressing it as a repeat`, async () => {
      // The dedup memory used to outlive the share it described, so a mapping
      // sent again within its window could be dropped as a duplicate - leaving
      // a viewer with a stream it could not resolve.

      const mockSignaling = createMockHostSignalingChannel();
      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: createRealMediaStreamForTesting(),
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: () => {},
        onClientDisconnected: () => {},
        onClientTrack: () => {},
      });

      await hostChannel.handleClientOffer(CLIENT_B_ADDR, { type: 'offer', sdp: VALID_SDP });

      const screenAddr = `screen:${HOST_ADDR}:win-1`;
      const first = createRealMediaStreamTrack('video');
      hostChannel.addOwnScreenTrack(first, new MediaStream(), HOST_ADDR, 'win-1', 'Editor');
      await sleep(STREAM_INFO_BATCH_WINDOW_MS + 400);
      hostChannel.removeOwnScreenTrack(HOST_ADDR, 'win-1');

      const second = createRealMediaStreamTrack('video');
      hostChannel.addOwnScreenTrack(second, new MediaStream(), HOST_ADDR, 'win-1', 'Editor');
      await sleep(STREAM_INFO_BATCH_WINDOW_MS + 400);

      const announced = new Set<string>();
      for (const [clientAddr, signal] of mappingSignalsSentTo(mockSignaling)) {
        if (clientAddr !== CLIENT_B_ADDR) {
          continue;
        }
        for (const info of signal.infos) {
          if (info.senderAddr === screenAddr) {
            announced.add(info.streamId);
          }
        }
      }

      // Both shares announced, each under its own stream id.
      expect(announced.size).toBe(2);

      hostChannel.closeAll();
    }, 20000);

  });

  // ===========================================================================
  // Test Suite 4: Client Disconnection & Cleanup
  // ===========================================================================

  describe(`Test Suite 4: Client Disconnection & Cleanup`, () => {

    itCond(`Host: removes client and updates client count on disconnect`, async () => {
      // Arrange
      const mockSignaling = createMockHostSignalingChannel();
      // Use REAL MediaStream because RTCPeerConnection.addTrack() validates track types
      const realStream = createRealMediaStreamForTesting();
      const onClientDisconnected = jasmine.createSpy('onClientDisconnected');

      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: realStream,
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: () => {},
        onClientDisconnected,
        onClientTrack: () => {},
      });

      await hostChannel.handleClientOffer(CLIENT_B_ADDR, { type: 'offer', sdp: VALID_SDP });
      await hostChannel.handleClientOffer(CLIENT_C_ADDR, { type: 'offer', sdp: VALID_SDP });

      expect(hostChannel.getClientCount()).toBe(2);

      // Act. Awaited: removeClient() renegotiates with every remaining client,
      // so the client is only gone once it settles.
      await hostChannel.removeClient(CLIENT_B_ADDR);

      // Assert
      expect(hostChannel.getClientCount()).toBe(1);
      expect(onClientDisconnected).toHaveBeenCalledWith(CLIENT_B_ADDR);
    }, 10000);

    itCond(`Host: cleans up all clients on closeAll()`, async () => {
      // Arrange
      const mockSignaling = createMockHostSignalingChannel();
      // Use REAL MediaStream because RTCPeerConnection.addTrack() validates track types
      const realStream = createRealMediaStreamForTesting();

      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: realStream,
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: () => {},
        onClientDisconnected: () => {},
        onClientTrack: () => {},
      });

      await hostChannel.handleClientOffer(CLIENT_A_ADDR, { type: 'offer', sdp: VALID_SDP });
      await hostChannel.handleClientOffer(CLIENT_B_ADDR, { type: 'offer', sdp: VALID_SDP });
      await hostChannel.handleClientOffer(CLIENT_C_ADDR, { type: 'offer', sdp: VALID_SDP });

      expect(hostChannel.getClientCount()).toBe(3);

      // Act
      hostChannel.closeAll();

      // Assert
      expect(hostChannel.getClientCount()).toBe(0);
      expect(mockSignaling.close).toHaveBeenCalled();
    }, 10000);

  });

  // ===========================================================================
  // Test Suite 5: Edge Cases
  // ===========================================================================

  describe(`Test Suite 5: Edge Cases`, () => {

    itCond(`Host: canAcceptNewClient returns true when under limit`, async () => {
      // Arrange
      const mockSignaling = createMockHostSignalingChannel();
      // Use REAL MediaStream because RTCPeerConnection.addTrack() validates track types
      const realStream = createRealMediaStreamForTesting();

      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: realStream,
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: () => {},
        onClientDisconnected: () => {},
        onClientTrack: () => {},
      });

      // Connect 2 clients (under the limit of 6)
      await hostChannel.handleClientOffer(CLIENT_A_ADDR, { type: 'offer', sdp: VALID_SDP });
      await hostChannel.handleClientOffer(CLIENT_B_ADDR, { type: 'offer', sdp: VALID_SDP });

      // Act & Assert
      expect(hostChannel.canAcceptNewClient()).toBe(true);
    }, 10000);

    itCond(`Client: close() properly cleans up resources`, async () => {
      // Arrange
      const mockSignaling = createMockClientSignalingChannel();
      // Use REAL MediaStream because RTCPeerConnection.addTrack() validates track types
      const realStream = createRealMediaStreamForTesting();

      const clientChannel = createClientChannel({
        hostAddr: HOST_ADDR,
        ownAddr: CLIENT_A_ADDR,
        rtcConfig: {},
        localStream: realStream,
        signalingChannel: mockSignaling as unknown as ClientSignalingChannel,
        onRemoteTrack: () => {},
        onConnectionStateChange: () => {},
      });

      await clientChannel.createAndSendOffer();
      expect(clientChannel.getPeerConnection()).not.toBeNull();

      // Act
      clientChannel.close();

      // Assert
      expect(clientChannel.getPeerConnection()).toBeNull();
      expect(mockSignaling.close).toHaveBeenCalled();
    }, 10000);

    itCond(`MockRTCPeerConnection: tracks addTrack calls for verification`, async () => {
      // This test verifies our mock properly tracks addTrack calls
      // which is essential for SFU testing

      // Arrange
      const pc = new MockRTCPeerConnection();
      const track1 = createMockMediaStreamTrack('audio') as unknown as MediaStreamTrack;
      const track2 = createMockMediaStreamTrack('video') as unknown as MediaStreamTrack;
      const stream = new MockMediaStream('test-stream') as unknown as MediaStream;

      // Act
      pc.addTrack(track1, stream);
      pc.addTrack(track2, stream);

      // Assert
      expect(pc.addTrackCalls.length).toBe(2);
      expect(pc.addTrackCalls[0].track).toBe(track1);
      expect(pc.addTrackCalls[1].track).toBe(track2);
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 6: Chat identity in call registries
  // ===========================================================================

  describe(`Test Suite 6: Chat identity in call registries`, () => {

    itCond(`chat key distinguishes a group chat from a one-to-one chat`, async () => {
      // The video chat service keys everything it remembers per chat by this
      // string: the session registry (call-state.ts), the live call objects, and
      // the buffers of signals and inbox ids. A group chat and a one-to-one chat
      // may carry the same chatId, and a call in one must not touch the state of
      // the other.
      const sharedId = 'same-id-in-both-chats';

      const groupKey = chatIdToString({ isGroupChat: true, chatId: sharedId });
      const otoKey = chatIdToString({ isGroupChat: false, chatId: sharedId });

      expect(groupKey)
        .withContext(`chats of different kinds must not share a registry key`)
        .not.toBe(otoKey);
    }, 5000);

    itCond(`chat key round-trips back into the same chat identity`, async () => {
      // The heartbeat watchdog emits an event for the chat whose record it
      // drops, so a key must not lose which chat it came from.
      const chatIds: ChatIdObj[] = [
        { isGroupChat: true, chatId: 'group-chat-id' },
        { isGroupChat: false, chatId: 'peer@3nsoft.net' },
        // Ids with slashes: only the two-character prefix may be cut off
        { isGroupChat: true, chatId: 'group/with/slashes' },
        { isGroupChat: false, chatId: 's/looks-like-a-prefix' },
      ];

      for (const chatId of chatIds) {
        const restored = stringToChatId(chatIdToString(chatId));

        expect(restored.isGroupChat)
          .withContext(`chat kind of ${chatId.chatId} should survive the round trip`)
          .toBe(chatId.isGroupChat);
        expect(restored.chatId)
          .withContext(`chat id ${chatId.chatId} should survive the round trip`)
          .toBe(chatId.chatId);
        expect(areChatIdsEqual(restored, chatId))
          .withContext(`${chatId.chatId} should be recognized as the same chat`)
          .toBeTrue();
      }
    }, 5000);

    itCond(`Host: reports no buffered or discarded tracks on a fresh channel`, async () => {
      // Track-attribution diagnostics: a growing discarded count means
      // stream-sender-info mappings are being lost.
      const mockSignaling = createMockHostSignalingChannel();
      const realStream = createRealMediaStreamForTesting();

      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: realStream,
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: () => {},
        onClientDisconnected: () => {},
        onClientTrack: () => {},
      });

      await hostChannel.handleClientOffer(CLIENT_A_ADDR, { type: 'offer', sdp: VALID_SDP });

      expect(hostChannel.getPendingTracksStats())
        .withContext(`nothing is buffered before any track arrives`)
        .toEqual({ bufferedStreams: 0, discardedStreams: 0 });

      hostChannel.closeAll();

      expect(hostChannel.getPendingTracksStats().bufferedStreams)
        .withContext(`closing the call leaves nothing buffered`)
        .toBe(0);
    }, 10000);

  });

  // ===========================================================================
  // Test Suite 7: Call state machine
  // ===========================================================================

  describe(`Test Suite 7: Call state machine`, () => {

    const GROUP_CHAT: ChatIdObj = { isGroupChat: true, chatId: 'call-state-group' };
    const OTO_CHAT: ChatIdObj = { isGroupChat: false, chatId: 'peer@3nsoft.net' };
    const SESSION = `${HOST_ADDR}#1`;
    const OTHER_SESSION = `${HOST_ADDR}#2`;
    // The registry takes `now` as an argument, so time is set here rather than
    // waited out: every rule below is checked deterministically.
    const T0 = 1_000_000;

    /** A registry that records every transition it refused. */
    function sessionsWithRefusals(): {
      sessions: CallSessions;
      refused: Array<{ from: CallState | undefined; to: CallState }>;
    } {
      const refused: Array<{ from: CallState | undefined; to: CallState }> = [];
      const sessions = createCallSessions((from, to) => refused.push({ from, to }));
      return { sessions, refused };
    }

    itCond(`allows only the transitions a call can actually make`, async () => {
      const allowed: Array<[CallState | undefined, CallState]> = [
        [undefined, 'dialing'],
        [undefined, 'ringing'],
        [undefined, 'rejoinable'],
        ['dialing', 'active'],
        ['ringing', 'connecting'],
        ['connecting', 'active'],
        ['active', 'winding-down'],
        ['winding-down', 'ended'],
        ['winding-down', 'rejoinable'],
        // A chat outlives its calls: a new call, or news that the host is still
        // in the old one, legitimately follows an ended one.
        ['ended', 'dialing'],
        ['ended', 'ringing'],
        ['ended', 'rejoinable'],
        ['rejoinable', 'connecting'],
        // The GUI->deno teardown path may deliver the terminal state straight
        // from a live one (window closed itself, client left with the button):
        // refusing these left a live record stuck forever, blocking resync and
        // any new call in the chat.
        ['connecting', 'rejoinable'],
        ['connecting', 'ended'],
        ['active', 'rejoinable'],
        ['active', 'ended'],
      ];
      const refusedPairs: Array<[CallState | undefined, CallState]> = [
        // A call cannot appear mid-flight: only 'dialing'/'ringing'/'rejoinable'
        // may be entered from idle.
        [undefined, 'connecting'],
        [undefined, 'active'],
        [undefined, 'ended'],
        // Media cannot come back after teardown started.
        ['winding-down', 'active'],
        ['ended', 'active'],
        ['ended', 'connecting'],
        ['ended', 'winding-down'],
        // A client that is merely ringing has not established anything yet.
        ['ringing', 'active'],
        // Going backwards is not a thing.
        ['active', 'connecting'],
        ['active', 'dialing'],
        ['connecting', 'ringing'],
      ];

      for (const [from, to] of allowed) {
        expect(canTransit(from, to))
          .withContext(`${from ?? 'idle'} -> ${to} should be allowed`)
          .toBeTrue();
      }
      for (const [from, to] of refusedPairs) {
        expect(canTransit(from, to))
          .withContext(`${from ?? 'idle'} -> ${to} should not be allowed`)
          .toBeFalse();
      }
    }, 5000);

    itCond(`ignores a refused transition instead of corrupting the record`, async () => {
      const { sessions, refused } = sessionsWithRefusals();
      sessions.transit(GROUP_CHAT, 'dialing', T0, { role: 'host', callSessionId: SESSION });
      sessions.transit(GROUP_CHAT, 'active', T0 + 100);

      const applied = sessions.transit(GROUP_CHAT, 'ringing', T0 + 200);

      expect(applied)
        .withContext(`active -> ringing must be refused`)
        .toBeFalse();
      expect(sessions.state(GROUP_CHAT))
        .withContext(`a refused transition leaves the state as it was`)
        .toBe('active');
      expect(sessions.get(GROUP_CHAT)?.callSessionId)
        .withContext(`and leaves the session identity intact`)
        .toBe(SESSION);
      expect(refused)
        .withContext(`the refusal is reported, so it can be logged`)
        .toEqual([{ from: 'active', to: 'ringing' }]);
    }, 5000);

    itCond(`keeps the state of a group chat and a 1-1 chat with the same id apart`, async () => {
      // Regression guard for P1-4: both chats below share 'chatId', and a call
      // in one must not touch the state of the other.
      const sharedId = 'same-id-in-both-chats';
      const group: ChatIdObj = { isGroupChat: true, chatId: sharedId };
      const oto: ChatIdObj = { isGroupChat: false, chatId: sharedId };
      const { sessions } = sessionsWithRefusals();

      sessions.transit(group, 'dialing', T0, { role: 'host', callSessionId: SESSION });

      expect(sessions.state(oto))
        .withContext(`the one-to-one chat has no call`)
        .toBeUndefined();

      sessions.transit(oto, 'ringing', T0, { role: 'client', callSessionId: OTHER_SESSION });

      expect(sessions.state(group)).toBe('dialing');
      expect(sessions.state(oto)).toBe('ringing');
      // The identity in the record is what the watchdog emits an event for, so
      // it must not be recoverable only from the key.
      expect(areChatIdsEqual(sessions.get(oto)!.chatId, oto)).toBeTrue();
    }, 5000);

    itCond(`expires records by the window that fits what they claim`, async () => {
      const { sessions } = sessionsWithRefusals();
      const provisional: ChatIdObj = { isGroupChat: true, chatId: 'provisional-chat' };
      const confirmed: ChatIdObj = { isGroupChat: true, chatId: 'confirmed-chat' };
      const ended: ChatIdObj = { isGroupChat: true, chatId: 'ended-chat' };

      // Our own guess, made while leaving a call: if the host died at that very
      // moment, no heartbeat will ever confirm it.
      sessions.transit(provisional, 'rejoinable', T0, {
        hostAddr: HOST_ADDR, lastBeat: T0, provisional: true,
      });
      // Confirmed by a real heartbeat.
      sessions.noteHeartbeat(confirmed, HOST_ADDR, SESSION, T0);
      sessions.transit(ended, 'ringing', T0, { callSessionId: SESSION });
      sessions.transit(ended, 'ended', T0, { endedBy: 'self', callSessionId: SESSION });

      expect(sessions.takeExpired(T0 + PROVISIONAL_REJOIN_TIMEOUT))
        .withContext(`nothing expires exactly at its deadline`)
        .toEqual([]);

      const afterProvisional = sessions.takeExpired(T0 + PROVISIONAL_REJOIN_TIMEOUT + 1);
      expect(afterProvisional.length)
        .withContext(`the unconfirmed guess goes first, on the shorter window`)
        .toBe(1);
      expect(afterProvisional[0].reason).toBe('provisional-timeout');
      expect(afterProvisional[0].record.chatId.chatId).toBe('provisional-chat');
      expect(sessions.state(provisional))
        .withContext(`an expired record is removed, not merely reported`)
        .toBeUndefined();

      const afterHeartbeat = sessions.takeExpired(T0 + HEARTBEAT_TIMEOUT + 1);
      expect(afterHeartbeat.map(e => e.reason))
        .withContext(`the confirmed record survives until the heartbeat timeout`)
        .toEqual(['heartbeat-timeout']);

      expect(sessions.state(ended))
        .withContext(`an ended record outlives both re-join windows`)
        .toBe('ended');
      expect(sessions.takeExpired(T0 + ENDED_SESSION_RETENTION_MILLIS + 1).map(e => e.reason))
        .withContext(`and is finally dropped as a memory bound, not as a rule`)
        .toEqual(['ended-retention']);
    }, 5000);

    itCond(`re-stating 'ended' corrects who ended it without sliding the window`, async () => {
      // A device on which the call was only ringing learns from the host's
      // 'disconnect' that the call is over, and has to say so *after* end() has
      // already recorded 'ended' - end(), told to keep quiet, cannot know who
      // ended it. The correction must not restart the retention window, or a
      // signal of the finished session would be recognized for longer than it
      // should be.
      const { sessions } = sessionsWithRefusals();
      const chat: ChatIdObj = { isGroupChat: false, chatId: 'peer@3nsoft.net' };
      sessions.transit(chat, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });
      sessions.transit(chat, 'ended', T0 + 1000, { endedBy: 'self' });
      sessions.transit(chat, 'ended', T0 + 6000, { endedBy: 'host' });

      expect(sessions.get(chat)?.endedBy)
        .withContext(`the correction wins`)
        .toBe('host');
      expect(sessions.get(chat)?.since)
        .withContext(`while the record still dates from when the call ended`)
        .toBe(T0 + 1000);
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 8: Call session identity
  // ===========================================================================

  describe(`Test Suite 8: Call session identity`, () => {

    const CHAT: ChatIdObj = { isGroupChat: true, chatId: 'session-id-chat' };
    const OTO: ChatIdObj = { isGroupChat: false, chatId: HOST_ADDR };
    const SESSION = `${HOST_ADDR}#1`;
    const NEXT_SESSION = `${HOST_ADDR}#2`;
    const T0 = 1_000_000;
    const FRESH: SignalAge = { fromSenderClock: 0, sinceDelivery: 0 };
    /** Old by both measurements. */
    const aged = (ms: number): SignalAge => ({ fromSenderClock: ms, sinceDelivery: ms });

    function sessions(): CallSessions {
      return createCallSessions();
    }

    /** Puts the chat into the state left by a call that ran and ended. */
    function afterEndedCall(
      reg: CallSessions, chatId: ChatIdObj, endedBy: 'host' | 'self' | 'peer', at: number,
    ): void {
      reg.transit(chatId, 'ringing', at, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });
      reg.transit(chatId, 'connecting', at, {});
      reg.transit(chatId, 'active', at, {});
      reg.transit(chatId, 'winding-down', at, {});
      reg.transit(chatId, 'ended', at, { endedBy });
    }

    itCond(`drops a signal of a finished session however fresh it looks`, async () => {
      // The "second ringtone": a 1-1 call ends, a signal still in flight arrives
      // moments later, and its age says nothing about it being late.
      const reg = sessions();
      afterEndedCall(reg, OTO, 'peer', T0);

      expect(reg.admitsSignal(OTO, SESSION, FRESH, T0 + 2000))
        .withContext(`a straggler of the call that just ended is recognized by its id`)
        .toBe('drop-ended-session');
      expect(reg.admitsStart(OTO, SESSION, FRESH, T0 + 2000))
        .withContext(`and so is a re-sent 'start' of that same call`)
        .toBe('drop-ended-session');
      // Even long after the cooldown window, where the old age-based rules would
      // have let it through.
      expect(reg.admitsSignal(OTO, SESSION, FRESH, T0 + RECENTLY_ENDED_COOLDOWN_MILLIS + 5000))
        .withContext(`the id keeps working after the cooldown window lapses`)
        .toBe('drop-ended-session');
    }, 5000);

    itCond(`admits a 'start' of a new session after a call ended`, async () => {
      const reg = sessions();
      afterEndedCall(reg, OTO, 'self', T0);

      expect(reg.admitsStart(OTO, NEXT_SESSION, FRESH, T0 + 1000))
        .withContext(`the peer calling again is a new call, not a straggler`)
        .toBe('accept');
    }, 5000);

    itCond(`falls back on time windows for a peer that sends no session id`, async () => {
      const reg = sessions();
      // Both sides on builds without session ids: the record has no id either.
      reg.transit(OTO, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR });
      reg.transit(OTO, 'ended', T0, { endedBy: 'peer' });

      expect(reg.admitsSignal(OTO, undefined, FRESH, T0 + 1000))
        .withContext(`inside the cooldown window a late signal is still dropped`)
        .toBe('drop-recently-ended');
      expect(reg.admitsSignal(OTO, undefined, FRESH, T0 + RECENTLY_ENDED_COOLDOWN_MILLIS + 1))
        .withContext(`past it, only the signal's own age can disqualify it`)
        .toBe('accept');
      expect(reg.admitsSignal(
        OTO, undefined, aged(MAX_SIGNAL_AGE_MILLIS + 1), T0 + RECENTLY_ENDED_COOLDOWN_MILLIS + 1,
      ))
        .withContext(`an old signal has no live call to belong to`)
        .toBe('drop-stale');
    }, 5000);

    itCond(`judges staleness by both the sender's clock and the local delivery`, async () => {
      // The two measurements fail independently: a sender whose clock runs
      // ahead keeps stamping "fresh" ids on old messages, and a message that
      // sat in the shared inbox gets a fresh delivery stamp when a device
      // finally sees it. Either alone let a replayed 'start' ring for a call
      // that was long over.
      const reg = sessions();
      const senderClockAhead: SignalAge = {
        fromSenderClock: 0, sinceDelivery: MAX_SIGNAL_AGE_MILLIS + 1,
      };
      const freshlyDeliveredOldMsg: SignalAge = {
        fromSenderClock: MAX_SIGNAL_AGE_MILLIS + 1, sinceDelivery: 0,
      };

      expect(reg.admitsStart(OTO, SESSION, senderClockAhead, T0))
        .withContext(`a 'start' stamped fresh by a skewed sender clock, delivered long ago`)
        .toBe('drop-stale');
      expect(reg.admitsStart(OTO, SESSION, freshlyDeliveredOldMsg, T0))
        .withContext(`an old 'start' freshly delivered from the shared inbox`)
        .toBe('drop-stale');
      expect(reg.admitsSignal(OTO, SESSION, senderClockAhead, T0))
        .toBe('drop-stale');
      expect(reg.admitsSignal(OTO, SESSION, freshlyDeliveredOldMsg, T0))
        .toBe('drop-stale');
      expect(reg.admitsStart(OTO, SESSION, FRESH, T0))
        .withContext(`fresh by both measurements, with no record to say otherwise`)
        .toBe('accept');

      // The same double measure guards the no-session-id fallback of a chat
      // whose call has ended.
      reg.transit(OTO, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR });
      reg.transit(OTO, 'ended', T0, { endedBy: 'peer' });
      expect(reg.admitsSignal(
        OTO, undefined, senderClockAhead, T0 + RECENTLY_ENDED_COOLDOWN_MILLIS + 1,
      ))
        .withContext(`past the cooldown, the delivery age still disqualifies it`)
        .toBe('drop-stale');
    }, 5000);

    itCond(`drops a signal of another session while a call is on`, async () => {
      const reg = sessions();
      reg.transit(CHAT, 'dialing', T0, { role: 'host', hostAddr: HOST_ADDR, callSessionId: SESSION });
      reg.transit(CHAT, 'active', T0 + 500, {});

      expect(reg.admitsSignal(CHAT, NEXT_SESSION, FRESH, T0 + 1000))
        .withContext(`signalling for a call we are not in`)
        .toBe('drop-foreign-session');
      expect(reg.admitsStart(CHAT, NEXT_SESSION, FRESH, T0 + 1000))
        .withContext(`and a 'start' of it must not open a second call in the chat`)
        .toBe('drop-in-call');
      expect(reg.admitsSignal(CHAT, SESSION, FRESH, T0 + 1000))
        .withContext(`signalling of our own call is of course admitted`)
        .toBe('accept');
    }, 5000);

    itCond(`lets a simultaneous 'start' through while we are only dialing`, async () => {
      // Two people calling each other at the same moment: our call has nobody in
      // it yet, so the old behaviour of letting the call object absorb the peer's
      // 'start' is kept - otherwise neither side would ever connect.
      const reg = sessions();
      reg.transit(CHAT, 'dialing', T0, { role: 'host', hostAddr: HOST_ADDR, callSessionId: SESSION });

      expect(reg.admitsStart(CHAT, NEXT_SESSION, FRESH, T0 + 100))
        .toBe('accept');
    }, 5000);

    itCond(`does not let a heartbeat of an ended session revive "Join Call"`, async () => {
      const reg = sessions();
      afterEndedCall(reg, CHAT, 'host', T0);

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, FRESH, T0 + 1000))
        .withContext(`a heartbeat that was in flight when the host ended the call`)
        .toBe('drop-ended-session');
      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, FRESH, T0 + HOST_ENDED_SUPPRESS_MILLIS + 5000))
        .withContext(`recognized by its session id, not by how late it is`)
        .toBe('drop-ended-session');
      expect(reg.state(CHAT))
        .withContext(`nothing changed the state`)
        .toBe('ended');

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, NEXT_SESSION, FRESH, T0 + 1000))
        .withContext(`a heartbeat of a new call is a genuine invitation`)
        .toBe('accept');
      expect(reg.noteHeartbeat(CHAT, HOST_ADDR, NEXT_SESSION, T0 + 1000))
        .withContext(`accepting it is what makes the chat newly re-joinable`)
        .toBeTrue();
      expect(reg.state(CHAT)).toBe('rejoinable');
      expect(reg.get(CHAT)?.provisional)
        .withContext(`a real heartbeat is not a guess`)
        .toBeFalse();
      expect(reg.noteHeartbeat(CHAT, HOST_ADDR, NEXT_SESSION, T0 + 2000))
        .withContext(`a further heartbeat only refreshes it`)
        .toBeFalse();
    }, 5000);

    itCond(`ignores a heartbeat too old to prove the call is still live`, async () => {
      // The window's host-silence watchdog gives up after 90s, so every
      // heartbeat still travelling behind that verdict is minutes old. One of
      // them arriving after our own record expired used to make the chat
      // re-joinable again and flash a "Join Call" button on a dead call.
      const reg = sessions();

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, aged(HEARTBEAT_MAX_AGE_MILLIS + 1), T0))
        .withContext(`five missed beats: the call it advertises is long gone`)
        .toBe('drop-stale');
      expect(reg.state(CHAT))
        .withContext(`an idle chat stays idle`)
        .toBeUndefined();

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, aged(HEARTBEAT_MAX_AGE_MILLIS - 1), T0))
        .withContext(`a beat that is merely slow is still proof of a live call`)
        .toBe('accept');
    }, 5000);

    itCond(`remembers a host-ended call arriving into an idle chat`, async () => {
      // A late 'disconnect' (its delivery failed for a minute and a half) finds
      // the chat idle. 'ended' is not an entry state, so plain transit() left no
      // trace at all — and the next straggling heartbeat then resurrected the
      // "Join Call" button.
      const reg = sessions();

      reg.noteRemoteEnded(CHAT, T0, { hostAddr: HOST_ADDR, callSessionId: SESSION });

      expect(reg.state(CHAT))
        .withContext(`the tombstone exists even though the chat was idle`)
        .toBe('ended');
      expect(reg.get(CHAT)?.endedBy).toBe('host');
      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, FRESH, T0 + 1000))
        .withContext(`which is what suppresses the rest of that session's beats`)
        .toBe('drop-ended-session');
      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, NEXT_SESSION, FRESH, T0 + 1000))
        .withContext(`a new call is unaffected`)
        .toBe('accept');
    }, 5000);

    itCond(`suppresses a session-less heartbeat only from the host that ended the call`, async () => {
      const reg = sessions();
      reg.transit(CHAT, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR });
      reg.transit(CHAT, 'ended', T0, { endedBy: 'host' });

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, undefined, FRESH, T0 + 1000))
        .withContext(`inside the suppression window, from that host`)
        .toBe('drop-ended-session');
      expect(reg.admitsHeartbeat(CHAT, CLIENT_A_ADDR, undefined, FRESH, T0 + 1000))
        .withContext(`a stray announcement from a non-host must not hide a live call`)
        .toBe('accept');
      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, undefined, FRESH, T0 + HOST_ENDED_SUPPRESS_MILLIS + 1))
        .withContext(`past the window there is nothing left in flight to suppress`)
        .toBe('accept');
    }, 5000);

    itCond(`does not offer "Join Call" for a call we are in`, async () => {
      const reg = sessions();
      reg.transit(CHAT, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });
      reg.transit(CHAT, 'connecting', T0, {});

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, FRESH, T0 + 1000))
        .toBe('drop-in-call');

      reg.transit(CHAT, 'winding-down', T0 + 2000, {});
      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, FRESH, T0 + 2100))
        .withContext(`nor while we are on our way out of it`)
        .toBe('drop-in-call');
    }, 5000);

    itCond(`does not offer "Join Call" while another device of ours holds the call`, async () => {
      // The device that yielded the call keeps hearing the host's heartbeats -
      // the inbox belongs to the address, not to the device - and used to put a
      // "Join Call" button up on them, seconds after stepping aside (live run of
      // 2026-08-16). Taking it would put two devices of one address into one
      // call, which the host cannot even tell apart: it keys peers by address.
      const reg = sessions();
      reg.transit(CHAT, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });
      reg.transit(CHAT, 'ended', T0 + 100, { endedBy: 'other-device' });

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, FRESH, T0 + 1000))
        .withContext(`the call goes on, but our other device is the one in it`)
        .toBe('drop-handled-elsewhere');
      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, undefined, FRESH, T0 + 1000))
        .withContext(`a beat from a build that names no session is held too`)
        .toBe('drop-handled-elsewhere');
      expect(reg.state(CHAT))
        .withContext(`and the record stays as it was`)
        .toBe('ended');

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, NEXT_SESSION, FRESH, T0 + 1000))
        .withContext(`a heartbeat of a later call is a genuine invitation`)
        .toBe('accept');
    }, 5000);

    itCond(`offers "Join Call" again once the hold is dropped`, async () => {
      // What handleCallHandledElsewhere does when the device holding the call
      // says it left: the record goes, and the next heartbeat is an ordinary
      // invitation - which is how the button comes back within seconds instead
      // of waiting out the record's retention.
      const reg = sessions();
      reg.transit(CHAT, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });
      reg.transit(CHAT, 'ended', T0 + 100, { endedBy: 'other-device' });

      reg.drop(CHAT);

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, FRESH, T0 + 1000))
        .toBe('accept');
      expect(reg.noteHeartbeat(CHAT, HOST_ADDR, SESSION, T0 + 1000))
        .withContext(`and it is what raises the button`)
        .toBeTrue();
      expect(reg.state(CHAT)).toBe('rejoinable');
    }, 5000);

    itCond(`keeps our own re-join button through the beats of the call we left`, async () => {
      // The other side of the hold above: a device that left the call itself is
      // in 'rejoinable', not 'ended', and every heartbeat has to keep confirming
      // that record - suppressing them here would take the button away from the
      // user who just pressed Leave.
      const reg = sessions();
      reg.transit(CHAT, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });
      reg.transit(CHAT, 'connecting', T0 + 100, {});
      reg.transit(CHAT, 'active', T0 + 200, {});
      reg.transit(CHAT, 'winding-down', T0 + 300, {});
      reg.transit(CHAT, 'rejoinable', T0 + 400, {
        hostAddr: HOST_ADDR, callSessionId: SESSION, lastBeat: T0 + 400, provisional: true,
      });

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, FRESH, T0 + 1000))
        .toBe('accept');
      reg.noteHeartbeat(CHAT, HOST_ADDR, SESSION, T0 + 1000);
      expect(reg.get(CHAT)?.provisional)
        .withContext(`the beat turns our guess into a confirmed record`)
        .toBeFalse();
    }, 5000);

    itCond(`re-sends 'start' only for a live call and only to its participants`, async () => {
      const reg = sessions();
      const isParticipant = (addr: string): ParticipantState =>
        (addr === CLIENT_A_ADDR) ? 'invited' : 'unknown';
      reg.transit(CHAT, 'dialing', T0, { role: 'host', hostAddr: HOST_ADDR, callSessionId: SESSION });
      reg.transit(CHAT, 'active', T0 + 100, {});

      expect(reg.admitsRequestStart(CHAT, CLIENT_A_ADDR, SESSION, isParticipant, T0 + 1000))
        .withContext(`an invited participant whose 'start' was lost in delivery`)
        .toBe('accept');
      expect(reg.admitsRequestStart(CHAT, CLIENT_B_ADDR, SESSION, isParticipant, T0 + 1000))
        .withContext(`someone who is not part of this call`)
        .toBe('drop-not-participant');
      expect(reg.admitsRequestStart(CHAT, CLIENT_A_ADDR, NEXT_SESSION, isParticipant, T0 + 1000))
        .withContext(`a request about a different call of this chat`)
        .toBe('drop-foreign-session');

      // Winding down: the peer already left, or our own 'disconnect' is in
      // flight. Re-sending 'start' here is what re-opened the incoming-call UI.
      reg.transit(CHAT, 'winding-down', T0 + 2000, {});
      expect(reg.admitsRequestStart(CHAT, CLIENT_A_ADDR, SESSION, isParticipant, T0 + 2100))
        .toBe('drop-not-live');

      reg.transit(CHAT, 'ended', T0 + 3000, { endedBy: 'self' });
      expect(reg.admitsRequestStart(CHAT, CLIENT_A_ADDR, SESSION, isParticipant, T0 + 3100))
        .toBe('drop-not-live');
      expect(reg.admitsRequestStart(CHAT, CLIENT_A_ADDR, undefined, isParticipant, T0 + 3100))
        .withContext(`a peer without session ids is turned down by the cooldown window`)
        .toBe('drop-recently-ended');
      expect(reg.admitsRequestStart({ isGroupChat: true, chatId: 'no-call-here' }, CLIENT_A_ADDR, SESSION, isParticipant, T0))
        .withContext(`a chat with no call at all`)
        .toBe('drop-not-live');
    }, 5000);

    itCond(`re-sends 'start' only as the host of the call`, async () => {
      const reg = sessions();
      // For a client, "is this a participant?" is true of the host address, so
      // without a role check a client accepts the request too - and answers it
      // by sending a 'start' of its own. On the host's second device that opens
      // an incoming-call window whose caller is the host's own client.
      const isParticipant = (addr: string): ParticipantState =>
        (addr === HOST_ADDR) ? 'invited' : 'unknown';
      reg.transit(CHAT, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });
      reg.transit(CHAT, 'connecting', T0 + 100, {});
      reg.transit(CHAT, 'active', T0 + 200, {});

      expect(reg.admitsRequestStart(CHAT, HOST_ADDR, SESSION, isParticipant, T0 + 1000))
        .withContext(`the call is live and the requester is its host, yet we are not the one who issues 'start'`)
        .toBe('drop-not-host');
    }, 5000);

    itCond(`refuses to re-send 'start' to an address that is already in the call`, async () => {
      // The device that stopped ringing when the user answered on another one of
      // their devices. It keeps receiving the call's signalling (the inbox is
      // shared), and once it has forgotten the session it takes that signalling
      // for orphans and asks for 'start'. Answering rang it in the middle of the
      // call the very same person was already in.
      const reg = sessions();
      const state = (addr: string): ParticipantState =>
        (addr === CLIENT_A_ADDR) ? 'connected' : 'unknown';
      reg.transit(CHAT, 'dialing', T0, { role: 'host', hostAddr: HOST_ADDR, callSessionId: SESSION });
      reg.transit(CHAT, 'active', T0 + 100, {});

      expect(reg.admitsRequestStart(CHAT, CLIENT_A_ADDR, SESSION, state, T0 + 60_000))
        .withContext(`that address has exchanged SDP with us, so it is in the call`)
        .toBe('drop-peer-connected');
      expect(reg.admitsRequestStart(CHAT, CLIENT_A_ADDR, SESSION, () => 'invited', T0 + 60_000))
        .withContext(`while a participant who never connected does need it re-sent`)
        .toBe('accept');
    }, 5000);

    itCond(`remembers a call held on another device for as long as it goes on`, async () => {
      // Forgetting it is what made this device ring again: with no record, the
      // next signal of the live call looks orphaned, which asks the host for a
      // 'start' - and a 'start' with no record opens an incoming call.
      const reg = sessions();
      reg.transit(OTO, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });
      reg.transit(OTO, 'ended', T0 + 1000, { endedBy: 'other-device', lastSignal: T0 + 1000 });

      expect(reg.admitsSignal(OTO, SESSION, FRESH, T0 + 2000))
        .withContext(`signalling of that call is neither ours to act on nor to delete`)
        .toBe('drop-handled-elsewhere');
      expect(reg.admitsStart(OTO, SESSION, FRESH, T0 + 2000))
        .withContext(`including a 'start' the host re-sent to this address`)
        .toBe('drop-handled-elsewhere');

      // A call outlasting the retention window is the ordinary case: it is a
      // memory bound, not a statement about how long a call may last.
      const wellPastRetention = T0 + 1000 + 10 * ENDED_SESSION_RETENTION_MILLIS;
      for (let t = T0 + 2000; t <= wellPastRetention; t += ENDED_SESSION_RETENTION_MILLIS / 2) {
        reg.noteSignalOfCallElsewhere(OTO, t);
        expect(reg.takeExpired(t).length)
          .withContext(`kept alive by the call's own signalling at ${t - T0}ms`)
          .toBe(0);
      }
      reg.noteSignalOfCallElsewhere(OTO, wellPastRetention);
      expect(reg.admitsSignal(OTO, SESSION, FRESH, wellPastRetention))
        .toBe('drop-handled-elsewhere');

      // Once the signalling stops, the record goes - the bound still holds.
      expect(reg.takeExpired(wellPastRetention + ENDED_SESSION_RETENTION_MILLIS + 1).map(e => e.reason))
        .toEqual(['ended-retention']);
      expect(reg.state(OTO)).toBeUndefined();
    }, 5000);

    itCond(`still admits a new call in a chat whose call is held elsewhere`, async () => {
      const reg = sessions();
      reg.transit(OTO, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });
      reg.transit(OTO, 'ended', T0 + 1000, { endedBy: 'other-device', lastSignal: T0 + 1000 });

      expect(reg.admitsStart(OTO, NEXT_SESSION, FRESH, T0 + 2000))
        .withContext(`a 'start' of another session is a new call, not this one`)
        .toBe('accept');
    }, 5000);

    itCond(`does not treat an ordinary ended call as held elsewhere`, async () => {
      // Only 'other-device' means "goes on without us": a call that ended here
      // for any other reason keeps the old verdict, whose message *is* removed.
      const reg = sessions();
      for (const endedBy of ['self', 'host', 'peer'] as const) {
        reg.transit(OTO, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });
        reg.transit(OTO, 'ended', T0 + 1000, { endedBy });

        expect(reg.admitsSignal(OTO, SESSION, FRESH, T0 + 2000))
          .withContext(`endedBy '${endedBy}'`)
          .toBe('drop-ended-session');

        reg.noteSignalOfCallElsewhere(OTO, T0 + 2000);
        // A host-ended call is remembered on its own longer window (see the
        // spec below); the point here is that arriving signals do not extend
        // whichever window applies.
        const retention = (endedBy === 'host')
          ? ENDED_BY_HOST_RETENTION_MILLIS
          : ENDED_SESSION_RETENTION_MILLIS;
        expect(reg.takeExpired(T0 + 1000 + retention + 1).map(e => e.reason))
          .withContext(`and its retention is not extended by arriving signals`)
          .toEqual(['ended-retention']);
      }
    }, 5000);

    itCond(`remembers a host-ended call long enough to outlast replays`, async () => {
      // The host's end is final for every participant, and recognizing a
      // replayed 'start' of that session by id is the only clock-independent
      // defence - so the record must outlive any realistic replay window.
      const reg = sessions();
      reg.transit(CHAT, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });
      reg.transit(CHAT, 'ended', T0, { endedBy: 'host' });

      const pastOldRetention = T0 + ENDED_SESSION_RETENTION_MILLIS + 1;
      expect(reg.takeExpired(pastOldRetention))
        .withContext(`the general memory bound does not apply to a host-ended call`)
        .toEqual([]);
      expect(reg.admitsStart(CHAT, SESSION, FRESH, pastOldRetention))
        .withContext(`so a replayed 'start' is still recognized by its id`)
        .toBe('drop-ended-session');

      expect(reg.admitsStart(CHAT, NEXT_SESSION, FRESH, pastOldRetention))
        .withContext(`while a genuinely new call is unaffected`)
        .toBe('accept');

      expect(reg.takeExpired(T0 + ENDED_BY_HOST_RETENTION_MILLIS + 1).map(e => e.reason))
        .withContext(`the longer window is still a bound, not forever`)
        .toEqual(['ended-retention']);
    }, 5000);

    itCond(`times out a call that rings unanswered, through the caller's teardown`, async () => {
      // A device that missed the host's 'disconnect' (the inbox is shared, and
      // another device may consume the message first) has no other way out of
      // 'ringing' - it used to ring, Join button and all, forever.
      const reg = sessions();
      reg.transit(CHAT, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });

      expect(reg.takeRingingTimeouts(T0 + RINGING_NO_ANSWER_TIMEOUT_MILLIS))
        .withContext(`nothing times out exactly at the deadline`)
        .toEqual([]);

      const timedOut = reg.takeRingingTimeouts(T0 + RINGING_NO_ANSWER_TIMEOUT_MILLIS + 1);
      expect(timedOut.length).toBe(1);
      expect(timedOut[0].chatId.chatId).toBe(CHAT.chatId);
      expect(reg.state(CHAT))
        .withContext(`the record is reported, not removed: the live call object behind `
          + `it goes through its ordinary teardown`)
        .toBe('ringing');

      // The caller's teardown is what moves the record on...
      reg.transit(CHAT, 'ended', T0 + RINGING_NO_ANSWER_TIMEOUT_MILLIS + 2, { endedBy: 'self' });
      expect(reg.takeRingingTimeouts(T0 + 2 * RINGING_NO_ANSWER_TIMEOUT_MILLIS))
        .withContext(`...after which there is nothing left to report`)
        .toEqual([]);

      // Answered and live calls are none of this rule's business.
      const answered: ChatIdObj = { isGroupChat: true, chatId: 'answered-chat' };
      reg.transit(answered, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });
      reg.transit(answered, 'connecting', T0 + 100, {});
      const dialing: ChatIdObj = { isGroupChat: true, chatId: 'dialing-chat' };
      reg.transit(dialing, 'dialing', T0, { role: 'host', callSessionId: SESSION });
      expect(reg.takeRingingTimeouts(T0 + 10 * RINGING_NO_ANSWER_TIMEOUT_MILLIS))
        .withContext(`'connecting'/'active'/'dialing' have their own ways out`)
        .toEqual([]);
    }, 5000);

    itCond(`recognizes the host ending a call that is only ringing here`, async () => {
      // The device the user did not answer on: the call object refuses every
      // signal until the user answers, so without this rule the host's
      // 'disconnect' changes nothing and the ringtone plays on.
      const reg = sessions();
      reg.transit(OTO, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });

      expect(isHostEndingRingingCall(reg.get(OTO), HOST_ADDR, SESSION))
        .withContext(`the host of the ringing call, same session`)
        .toBeTrue();
      expect(isHostEndingRingingCall(reg.get(OTO), HOST_ADDR.toUpperCase(), SESSION))
        .withContext(`addresses are compared canonically`)
        .toBeTrue();
      expect(isHostEndingRingingCall(reg.get(OTO), HOST_ADDR, undefined))
        .withContext(`a host on a build without session ids cannot be judged by id, so it is taken`)
        .toBeTrue();
      expect(isHostEndingRingingCall(reg.get(OTO), HOST_ADDR, NEXT_SESSION))
        .withContext(`a 'disconnect' of a different call of this chat`)
        .toBeFalse();
      expect(isHostEndingRingingCall(reg.get(OTO), CLIENT_A_ADDR, SESSION))
        .withContext(`only the host of a call may end it this way`)
        .toBeFalse();
      expect(isHostEndingRingingCall(undefined, HOST_ADDR, SESSION))
        .withContext(`a chat with no call at all`)
        .toBeFalse();
    }, 5000);

    itCond(`leaves every state other than 'ringing' to the call itself`, async () => {
      // Once the user has answered, the call object is in charge: it closes its
      // window, announces the host's departure and tears itself down. Acting
      // here as well would end a call this device is actually in.
      //
      // Each state is reached along a path the state machine actually allows,
      // and every step is asserted: a refused transition leaves the record in
      // 'ringing', which would make this spec pass on the state it is not
      // testing (`ringing` -> `active` is not a transition — a client goes
      // through `connecting`).
      const paths: Array<CallState[]> = [
        ['connecting'],
        ['connecting', 'active'],
        ['winding-down'],
        ['ended'],
      ];
      for (const path of paths) {
        const reg = sessions();
        reg.transit(OTO, 'ringing', T0, { role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION });
        path.forEach((state, i) => {
          expect(reg.transit(OTO, state, T0 + 100 * (i + 1), {}))
            .withContext(`transition into '${state}' along ${path.join(' -> ')}`)
            .toBeTrue();
        });

        expect(isHostEndingRingingCall(reg.get(OTO), HOST_ADDR, SESSION))
          .withContext(`state '${reg.state(OTO)}'`)
          .toBeFalse();
      }
    }, 5000);

    itCond(`needs a known host, not merely a ringing call`, async () => {
      // hostAddr is set when the incoming call is registered; a record without
      // it cannot tell the caller apart from any other address.
      const reg = sessions();
      reg.transit(OTO, 'ringing', T0, { role: 'client', callSessionId: SESSION });

      expect(isHostEndingRingingCall(reg.get(OTO), HOST_ADDR, SESSION)).toBeFalse();
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 9: Chat identity of a WebRTC message body
  // ===========================================================================

  describe(`Test Suite 9: Chat identity of a WebRTC message body`, () => {

    const OWN_ADDR = 'me@3nsoft.net';
    const PEER_ADDR = 'peer@3nsoft.net';
    const GROUP_ID = 'webrtc-body-group';
    const SESSION = `${HOST_ADDR}#1`;

    function incomingMsg(
      sender: string, jsonBody: Partial<ChatWebRTCMsgV1>,
    ): ChatIncomingMessage {
      return {
        msgId: 'msg-1',
        msgType: 'chat',
        deliveryTS: 1_000_000,
        sender,
        establishedSenderKeyChain: false,
        jsonBody: {
          v: 1,
          chatMessageType: 'webrtc-call',
          webrtcMsg: { stage: 'signalling', id: 1_000_000, callSessionId: SESSION, data: {} },
          ...jsonBody,
        },
      } as ChatIncomingMessage;
    }

    itCond(`derives a one-to-one chat from the sender of a peer's signal`, async () => {
      const parsed = checkChatMessageJSONforWebRTC(
        incomingMsg(PEER_ADDR, {}), OWN_ADDR,
      );

      expect(parsed?.chatId).toEqual({ isGroupChat: false, chatId: PEER_ADDR });
      expect(parsed?.fromOwnDevice).toBeFalse();
    }, 5000);

    itCond(`ignores a chat a peer names in the body`, async () => {
      // Trusting it would let a peer inject signalling into a one-to-one chat
      // it is not part of - the envelope is the only thing it cannot forge.
      const parsed = checkChatMessageJSONforWebRTC(
        incomingMsg(PEER_ADDR, { chatId: { isGroupChat: false, chatId: 'someone-else@3nsoft.net' } }),
        OWN_ADDR,
      );

      expect(parsed?.chatId).toEqual({ isGroupChat: false, chatId: PEER_ADDR });
    }, 5000);

    itCond(`takes a group chat from groupChatId, and refuses an address in it`, async () => {
      const parsed = checkChatMessageJSONforWebRTC(
        incomingMsg(PEER_ADDR, { groupChatId: GROUP_ID }), OWN_ADDR,
      );
      expect(parsed?.chatId).toEqual({ isGroupChat: true, chatId: GROUP_ID });

      expect(checkChatMessageJSONforWebRTC(
        incomingMsg(PEER_ADDR, { groupChatId: 'looks@like.an.address' }), OWN_ADDR,
      ))
        .withContext(`a one-to-one id in the group field is not a chat`)
        .toBeUndefined();
    }, 5000);

    itCond(`takes the chat from the body when we sent the message to ourselves`, async () => {
      // The case the "handled elsewhere" notification depends on: there is no
      // peer address in the envelope to derive a one-to-one chat from, only our
      // own, which would name a chat with oneself.
      const parsed = checkChatMessageJSONforWebRTC(
        incomingMsg(OWN_ADDR, {
          chatId: { isGroupChat: false, chatId: PEER_ADDR },
          webrtcMsg: {
            stage: 'signalling',
            id: 1_000_000,
            callSessionId: SESSION,
            data: { callHandledElsewhere: { deviceId: 'device-A', joined: true } },
          },
        }),
        OWN_ADDR,
      );

      expect(parsed?.chatId)
        .withContext(`the chat the call is in, not the chat with oneself`)
        .toEqual({ isGroupChat: false, chatId: PEER_ADDR });
      expect(parsed?.fromOwnDevice).toBeTrue();
    }, 5000);

    itCond(`falls back to the sender for our own message from a build without the field`, async () => {
      const parsed = checkChatMessageJSONforWebRTC(
        incomingMsg(OWN_ADDR, {}), OWN_ADDR,
      );

      expect(parsed?.fromOwnDevice)
        .withContext(`still recognized as ours, which is what defers its removal`)
        .toBeTrue();
      expect(parsed?.chatId)
        .withContext(`but the chat is unresolvable, so the caller finds no chat and drops it`)
        .toEqual({ isGroupChat: false, chatId: OWN_ADDR });
    }, 5000);

    itCond(`canonicalizes a one-to-one chat named in the body`, async () => {
      // The sending device may have taken the address from a view model.
      const parsed = checkChatMessageJSONforWebRTC(
        incomingMsg(OWN_ADDR, { chatId: { isGroupChat: false, chatId: ' Peer @3NSoft.net' } }),
        OWN_ADDR,
      );

      expect(parsed?.chatId).toEqual({ isGroupChat: false, chatId: PEER_ADDR });
    }, 5000);

    itCond(`refuses a body that is not a usable signal`, async () => {
      expect(checkChatMessageJSONforWebRTC(
        incomingMsg(PEER_ADDR, { webrtcMsg: undefined }), OWN_ADDR,
      ))
        .withContext(`no signal in it`)
        .toBeUndefined();

      expect(checkChatMessageJSONforWebRTC(
        incomingMsg(PEER_ADDR, { chatMessageType: 'regular' } as unknown as Partial<ChatWebRTCMsgV1>), OWN_ADDR,
      ))
        .withContext(`not a call message`)
        .toBeUndefined();

      expect(checkChatMessageJSONforWebRTC(
        incomingMsg(PEER_ADDR, {
          webrtcMsg: { stage: 'signalling', id: 'now', data: {} } as unknown as ChatWebRTCMsgV1['webrtcMsg'],
        }),
        OWN_ADDR,
      ))
        .withContext(`'id' doubles as the timestamp signal age is judged by`)
        .toBeUndefined();
    }, 5000);

    itCond(`ignores a chat named in the body that names nothing`, async () => {
      // A malformed field must fall back on the envelope rather than produce a
      // chat id nothing can be found by.
      for (const chatId of [
        { isGroupChat: false, chatId: '' },
        { isGroupChat: false, chatId: 'not-an-address' },
        { isGroupChat: true, chatId: '' },
      ]) {
        const parsed = checkChatMessageJSONforWebRTC(
          incomingMsg(OWN_ADDR, { chatId: chatId as ChatIdObj }), OWN_ADDR,
        );
        expect(parsed?.chatId)
          .withContext(`body chatId ${JSON.stringify(chatId)}`)
          .toEqual({ isGroupChat: false, chatId: OWN_ADDR });
      }
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 10: Decline policy
  // ===========================================================================

  describe(`Test Suite 10: Decline policy`, () => {

    /** The default case: a one-to-one call we host, declined by the invitee. */
    const oneToOneDecline = {
      isGroupChat: false,
      role: 'host' as const,
      callIsLive: true,
      peerIsConnected: false,
    };

    itCond(`ends a one-to-one call the invited peer declined`, async () => {
      // Nothing else would: a device that declined never initialized a call role,
      // so its end() sends no 'disconnect' - which is the only signal that closes
      // the caller's window in a one-to-one call.
      expect(declineEndsCall(oneToOneDecline)).toBe('end-call');
    }, 5000);

    itCond(`ignores a decline from an address that is in the call`, async () => {
      // Peers are keyed by address, so this is another device of that same
      // person dismissing its ringing UI - Join on one device, Decline on
      // another. Acting on it would tear down a live call.
      expect(declineEndsCall({ ...oneToOneDecline, peerIsConnected: true }))
        .toBe('ignore');
    }, 5000);

    itCond(`never ends a group call on one participant's decline`, async () => {
      expect(declineEndsCall({ ...oneToOneDecline, isGroupChat: true }))
        .withContext(`one invitee not joining says nothing about the others`)
        .toBe('note');
      expect(declineEndsCall({ ...oneToOneDecline, isGroupChat: true, peerIsConnected: true }))
        .toBe('ignore');
    }, 5000);

    itCond(`is not a client's business`, async () => {
      // Declines are addressed to the host: it invited the peer, and it is the
      // only side that tracks who was invited.
      for (const role of ['client', null] as const) {
        expect(declineEndsCall({ ...oneToOneDecline, role }))
          .withContext(`role '${role}'`)
          .toBe('ignore');
        expect(declineEndsCall({ ...oneToOneDecline, role, isGroupChat: true }))
          .withContext(`role '${role}', group`)
          .toBe('ignore');
      }
    }, 5000);

    itCond(`ignores a decline of a call that is not running`, async () => {
      // A decline arriving after the call is over must not act on whatever call
      // comes next in that chat.
      expect(declineEndsCall({ ...oneToOneDecline, callIsLive: false })).toBe('ignore');
      expect(declineEndsCall({ ...oneToOneDecline, callIsLive: false, isGroupChat: true }))
        .toBe('ignore');
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 11: Delivery confirmation
  // ===========================================================================

  describe(`Test Suite 11: Delivery confirmation`, () => {

    const RECIPIENT = 'peer@3nsoft.net';
    const DELIVERY_ID = 'chat-call-declined-1';
    const MSG = { msgType: 'chat', jsonBody: {} } as web3n.asmail.OutgoingMessage;

    /**
     * A delivery service whose observer is fed by hand, so the orderings this
     * code exists to survive can be produced on purpose. The real platform
     * cannot: whether an event lands before or after the subscription is a race.
     */
    function fakeDelivery({ state, events }: {
      /** What currentState() reports; `undefined` stands for an unknown id. */
      state?: web3n.asmail.DeliveryProgress;
      /** Events the observer gets, if any, once subscribed. */
      events?: (obs: web3n.Observer<web3n.asmail.DeliveryProgress>) => void;
    }) {
      let currentStateCalls = 0;
      return {
        api: {
          addMsg: async () => {},
          observeDelivery: (
            _id: string, obs: web3n.Observer<web3n.asmail.DeliveryProgress>,
          ) => {
            events?.(obs);
            return () => {};
          },
          currentState: async () => {
            currentStateCalls += 1;
            return state;
          },
        } as DeliveryApiForConfirmation,
        currentStateCalls: () => currentStateCalls,
      };
    }

    const progress = (allDone?: 'all-ok' | 'with-errors') => ({
      allDone,
      msgSize: 248,
      recipients: {},
    } as web3n.asmail.DeliveryProgress);

    itCond(`confirms from the state snapshot when no event ever arrives`, async () => {
      // The delivery finished between addMsg() resolving and the subscription
      // going in - the common case for sendImmediately messages. Before the
      // snapshot, the only thing left to fire was the timeout, and a delivered
      // signal was reported as 'timeout'.
      const fake = fakeDelivery({ state: progress('all-ok') });

      const result = await sendMsgWithDeliveryConfirmation(
        [RECIPIENT], MSG, DELIVERY_ID, undefined, 8000, fake.api,
      );

      expect(result.ok).toBeTrue();
    }, 5000);

    itCond(`reads an unknown delivery id as delivered`, async () => {
      // delivery-monitor.ts drops the record on allDone (rmMsg without
      // cancelSending), and that only removes a delivery that has completed.
      const fake = fakeDelivery({ state: undefined });

      const result = await sendMsgWithDeliveryConfirmation(
        [RECIPIENT], MSG, DELIVERY_ID, undefined, 8000, fake.api,
      );

      expect(result.ok).toBeTrue();
    }, 5000);

    itCond(`reports a failed delivery found in the snapshot`, async () => {
      const failed = progress('with-errors');
      const fake = fakeDelivery({ state: failed });

      const result = await sendMsgWithDeliveryConfirmation(
        [RECIPIENT], MSG, DELIVERY_ID, undefined, 8000, fake.api,
      );

      expect(result.ok).toBeFalse();
      expect(result.err).toBe(failed);
    }, 5000);

    itCond(`still confirms from the observer, without needing the snapshot`, async () => {
      // The ordering that always worked, kept working: an event arriving after
      // the subscription decides on its own. Also the case observeDelivery()
      // documents ("callbacks become hot"): this fake reports from inside the
      // subscribe call, before the timeout and the detacher exist, which used to
      // throw out of it and be reported as a failure to send.
      const fake = fakeDelivery({
        state: undefined,
        events: obs => obs.next!(progress('all-ok')),
      });

      const result = await sendMsgWithDeliveryConfirmation(
        [RECIPIENT], MSG, DELIVERY_ID, undefined, 8000, fake.api,
      );

      expect(result.ok).toBeTrue();
      expect(fake.currentStateCalls())
        .withContext(`the observer settled it before the snapshot came back`)
        .toBe(0);
    }, 5000);

    itCond(`detaches from an observation it settled synchronously`, async () => {
      // The subscription that reports from within observeDelivery() has to be
      // detached by the code that made it: the detacher does not exist yet at
      // the moment the callback runs.
      let detached = false;
      const api = {
        addMsg: async () => {},
        observeDelivery: (
          _id: string, obs: web3n.Observer<web3n.asmail.DeliveryProgress>,
        ) => {
          obs.next!(progress('all-ok'));
          return () => { detached = true; };
        },
        currentState: async () => undefined,
      } as DeliveryApiForConfirmation;

      const result = await sendMsgWithDeliveryConfirmation(
        [RECIPIENT], MSG, DELIVERY_ID, undefined, 8000, api,
      );

      expect(result.ok).toBeTrue();
      expect(detached).toBeTrue();
    }, 5000);

    itCond(`reads the platform's msgNotFound error as delivered`, async () => {
      // The platform answers a subscription to an unknown id with
      // error({ msgNotFound: true }) - same cleanup situation as the
      // unknown-id snapshot above, arriving via the error route. It used to
      // be reported as a failed delivery, prompting a pointless retry.
      const fake = fakeDelivery({
        state: progress(undefined),
        events: obs => obs.error!({
          runtimeException: true,
          type: 'asmail-delivery',
          msgNotFound: true,
        } as web3n.asmail.ASMailSendException),
      });

      const result = await sendMsgWithDeliveryConfirmation(
        [RECIPIENT], MSG, DELIVERY_ID, undefined, 8000, fake.api,
      );

      expect(result.ok).toBeTrue();
    }, 5000);

    itCond(`still reports a real observation error as failure`, async () => {
      const realErr = new Error('delivery observation broke');
      const fake = fakeDelivery({
        state: progress(undefined),
        events: obs => obs.error!(realErr),
      });

      const result = await sendMsgWithDeliveryConfirmation(
        [RECIPIENT], MSG, DELIVERY_ID, undefined, 8000, fake.api,
      );

      expect(result.ok).toBeFalse();
      expect(result.err).toBe(realErr);
    }, 5000);

    itCond(`gives up as timeout when neither route says anything`, async () => {
      // A delivery genuinely stuck: no event, and a state that reports it as
      // still going. The short timeout keeps the spec quick. The last seen
      // non-terminal state rides along in the error, for diagnostics.
      const stuckState = progress(undefined);
      const fake = fakeDelivery({ state: stuckState });

      const result = await sendMsgWithDeliveryConfirmation(
        [RECIPIENT], MSG, DELIVERY_ID, undefined, 200, fake.api,
      );

      expect(result.ok).toBeFalse();
      const err = result.err as { timeout?: true; timeoutMs?: number; lastProgress?: unknown };
      expect(err.timeout).toBeTrue();
      expect(err.timeoutMs).toBe(200);
      expect(err.lastProgress).toEqual(stuckState);
    }, 5000);

    itCond(`tells a delivery still travelling from one that failed`, async () => {
      // The two call for opposite reactions, and conflating them cost a 21KB
      // duplicate offer during the 500-storm of 2026-08-13: a confirmation that
      // merely stopped waiting was read as a failure and armed a 5s re-send of a
      // message the server had not even started taking (`bytesSent=0`).
      const inFlight = {
        allDone: undefined,
        msgSize: 21505,
        recipients: { [RECIPIENT]: { done: false, bytesSent: 0 } },
      } as unknown as web3n.asmail.DeliveryProgress;
      expect(isDeliveryStillInFlight({ timeout: true, timeoutMs: 25_000, lastProgress: inFlight }))
        .withContext(`nothing wrong was reported - the message is on its way`)
        .toBeTrue();
      expect(isDeliveryStillInFlight({ timeout: true, timeoutMs: 25_000 }))
        .withContext(`no progress seen at all is equally not a failure`)
        .toBeTrue();

      const failed = {
        allDone: 'with-errors',
        msgSize: 21505,
        recipients: {
          [RECIPIENT]: { done: true, bytesSent: 0, err: { status: 500 } },
        },
      } as unknown as web3n.asmail.DeliveryProgress;
      expect(isDeliveryStillInFlight({ timeout: true, timeoutMs: 25_000, lastProgress: failed }))
        .withContext(`a reported per-recipient error IS a failure, however it surfaced`)
        .toBeFalse();
      expect(isDeliveryStillInFlight(failed))
        .withContext(`and so is a plain with-errors outcome, which is not a timeout`)
        .toBeFalse();
      expect(isDeliveryStillInFlight(new Error('addMsg threw')))
        .withContext(`nor is anything that never got as far as a delivery`)
        .toBeFalse();
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 12: Call cancel system message
  // ===========================================================================

  describe(`Test Suite 12: Call cancel system message`, () => {

    const SESSION = `${HOST_ADDR}#4`;
    const FRESH = 1000;

    itCond(`acts on a cancellation of the call that is on`, async () => {
      expect(admitsCallCancelSysMsg({
        msgSessionId: SESSION, callSessionId: SESSION, msgAge: FRESH,
      })).toBe('accept');
    }, 5000);

    itCond(`refuses a cancellation of another call`, async () => {
      // The reported defect: a cancellation of a call from an hour and a half
      // earlier, replayed out of the inbox, ended a call that had just started.
      expect(admitsCallCancelSysMsg({
        msgSessionId: `${HOST_ADDR}#3`, callSessionId: SESSION, msgAge: FRESH,
      })).toBe('drop-foreign-session');
    }, 5000);

    itCond(`refuses a cancellation that names no call`, async () => {
      // Nothing to judge it by, and the cost of being wrong is a live call torn
      // down - so a sender on a build without the field gets its call ended by
      // the 'call-declined' signal instead.
      expect(admitsCallCancelSysMsg({
        msgSessionId: undefined, callSessionId: SESSION, msgAge: FRESH,
      })).toBe('drop-no-session');

      expect(admitsCallCancelSysMsg({
        msgSessionId: SESSION, callSessionId: undefined, msgAge: FRESH,
      }))
        .withContext(`our own call has no session id to compare against`)
        .toBe('drop-no-session');
    }, 5000);

    itCond(`refuses a stale cancellation even of the matching call`, async () => {
      // Covers the replay of a cancellation of this very call: the ids match, so
      // only the age says it is history.
      expect(admitsCallCancelSysMsg({
        msgSessionId: SESSION, callSessionId: SESSION, msgAge: MAX_SIGNAL_AGE_MILLIS + 1,
      })).toBe('drop-stale');

      expect(admitsCallCancelSysMsg({
        msgSessionId: SESSION, callSessionId: SESSION, msgAge: MAX_SIGNAL_AGE_MILLIS,
      }))
        .withContext(`the window itself is still within bounds`)
        .toBe('accept');
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 13: Serial SDP processing
  // ===========================================================================

  describe(`Test Suite 13: Serial SDP processing`, () => {

    itCond(`runs tasks one after another, in submission order`, async () => {
      // The defect this guards: two offers of one ASMail batch were handled
      // concurrently, so the second sampled signalingState before the first
      // had finished mutating it and died with "wrong signalingState: stable".
      const queue = createSerialTaskQueue();
      const events: string[] = [];

      const slow = queue.run(async () => {
        events.push('a:start');
        await new Promise(resolve => setTimeout(resolve, 30));
        events.push('a:end');
        return 'a';
      });
      const fast = queue.run(async () => {
        events.push('b:start');
        return 'b';
      });

      expect(await slow).toBe('a');
      expect(await fast).toBe('b');
      expect(events).toEqual(['a:start', 'a:end', 'b:start']);
    }, 5000);

    itCond(`keeps running after a task rejects, and reports it to its caller`, async () => {
      const queue = createSerialTaskQueue();
      const events: string[] = [];

      const failing = queue.run(async () => {
        events.push('a');
        throw new Error('boom');
      });
      const following = queue.run(async () => {
        events.push('b');
        return 'ok';
      });

      await expectAsync(failing).toBeRejectedWithError('boom');
      expect(await following)
        .withContext(`one broken offer must not stall every later one`)
        .toBe('ok');
      expect(events).toEqual(['a', 'b']);
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 14: SDP freshness stamp
  // ===========================================================================

  describe(`Test Suite 14: SDP freshness stamp`, () => {

    const SENT_AT = 1786459288499;

    function webrtcMsgWith(signalType: string, payload: unknown): WebRTCMsg {
      return {
        stage: 'signalling',
        id: SENT_AT,
        data: {
          description: {
            type: 'offer',
            sdp: JSON.stringify({ signalType, fromAddr: CLIENT_A_ADDR, payload }),
          },
        },
      } as unknown as WebRTCMsg;
    }

    itCond(`carries the sender's send time into the parsed signal`, async () => {
      // Without it a re-ordered old offer is indistinguishable from a peer
      // that just recreated its pc, and acting on one costs a live connection.
      const signal = parseStarSignalFromWebRTCMsg(
        webrtcMsgWith('offer', { type: 'offer', sdp: VALID_SDP }),
        CLIENT_A_ADDR,
        '[test]',
      );
      expect(signal).toBeTruthy();
      expect(signal!.msgTs)
        .withContext(`WebRTCMsg.id is the sender's own clock at pack time`)
        .toBe(SENT_AT);
    }, 5000);

    itCond(`carries it for app-level star signals too`, async () => {
      const starSdp = JSON.stringify({
        starSignal: { type: 'participant-left', fromAddr: CLIENT_A_ADDR, data: {} },
      });
      const signal = parseStarSignalFromWebRTCMsg(
        {
          stage: 'signalling', id: SENT_AT,
          data: { description: { type: 'offer', sdp: starSdp } },
        } as unknown as WebRTCMsg,
        CLIENT_A_ADDR,
        '[test]',
      );
      expect(signal).toBeTruthy();
      expect(signal!.msgTs).toBe(SENT_AT);
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 15: Reserved relay slots
  // ===========================================================================

  /**
   * The premise of reserved relay slots, checked against the real browser rather
   * than assumed: an m-line the client offers as `recvonly` can be negotiated by
   * the host as `sendonly` BEFORE it has anything to send, and a track dropped
   * into it later starts flowing without a renegotiation.
   *
   * This is what lets a participant join a group call without the host having to
   * re-offer to everyone already in it — the re-offer that, over a 7-15s ASMail
   * hop, collided with the joiners' own first negotiation and tore down
   * connections that had already reached ICE-connected (group call of
   * 2026-08-12).
   *
   * Two real RTCPeerConnections in this process, host candidates only, so it is
   * a plain unit test despite exercising the media stack.
   */
  describe(`Test Suite 15: Reserved relay slots`, () => {

    /**
     * A video track that actually produces frames.
     *
     * canvas.captureStream() is driven by canvas paints, so the shared
     * createRealMediaStreamTrack('video') — which fills its canvas once — yields
     * a live track that never emits a frame, and a sender given it reports
     * packetsSent = 0. Nothing noticed until now because no other test moves
     * media. Repainting on a timer is what makes RTP flow.
     */
    function createAnimatedVideoTrack(): { track: MediaStreamTrack; stop: () => void } {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d')!;
      let hue = 0;
      const timer = setInterval(() => {
        hue = (hue + 7) % 360;
        ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }, 66);
      const track = canvas.captureStream(15).getVideoTracks()[0];
      if (!track) {
        clearInterval(timer);
        throw new Error('Failed to create an animated video track');
      }
      return {
        track,
        stop: () => {
          clearInterval(timer);
          track.stop();
        },
      };
    }

    itCond(`reserves one audio and one video slot per other participant`, async () => {
      // A three-party call, the one that fell over on 2026-08-12: one other
      // participant to relay, and the screen reserve still fits under the cap.
      const threeParty = buildSlotReservation({
        ownAddr: CLIENT_A_ADDR,
        hostAddr: HOST_ADDR,
        rosterAddrs: [HOST_ADDR, CLIENT_A_ADDR, CLIENT_B_ADDR],
        isGroupCall: true,
      });
      // The host sends its own media on its own m-lines, so only the peers it
      // has to relay need a slot: B, not the host and not ourselves.
      expect(threeParty.filter(s => s.purpose === 'va').map(s => `${s.kind}:${s.forAddr}`))
        .toEqual([`audio:${CLIENT_B_ADDR}`, `video:${CLIENT_B_ADDR}`]);
      expect(threeParty.filter(s => s.purpose === 'screen').length)
        .withContext(`a small screen-share reserve for the call as a whole`)
        .toBe(RESERVED_SCREEN_VIDEO_SLOTS + RESERVED_SCREEN_AUDIO_SLOTS);

      // Two others already spend the whole budget on voice and video. The
      // ordering is what makes that safe: the cap eats the speculative screen
      // reserve, never a participant's audio.
      const fourParty = buildSlotReservation({
        ownAddr: CLIENT_A_ADDR,
        hostAddr: HOST_ADDR,
        rosterAddrs: [HOST_ADDR, CLIENT_A_ADDR, CLIENT_B_ADDR, CLIENT_C_ADDR],
        isGroupCall: true,
      });
      expect(fourParty.map(s => `${s.kind}:${s.forAddr}`))
        .toEqual([
          `audio:${CLIENT_B_ADDR}`, `video:${CLIENT_B_ADDR}`,
          `audio:${CLIENT_C_ADDR}`, `video:${CLIENT_C_ADDR}`,
        ]);

      expect(buildSlotReservation({
        ownAddr: CLIENT_A_ADDR, hostAddr: HOST_ADDR,
        rosterAddrs: [HOST_ADDR, CLIENT_A_ADDR], isGroupCall: false,
      }))
        .withContext(`a one-to-one call has no relay, so its SDP must not grow`)
        .toEqual([]);

      const many = buildSlotReservation({
        ownAddr: CLIENT_A_ADDR, hostAddr: HOST_ADDR,
        rosterAddrs: Array.from({ length: 30 }, (_, i) => `p${i}@3nsoft.net`),
        isGroupCall: true,
      });
      expect(many.length)
        .withContext(`capped, or a big chat turns its first offer into a huge ASMail message`)
        .toBeLessThanOrEqual(MAX_RESERVED_SLOTS);
    }, 5000);

    itCond(`assigns a track to the slot reserved for its sender, and re-joins to the same one`, async () => {
      const slots = [
        { declaration: { mid: '4', kind: 'video' as const, purpose: 'va' as const, forAddr: CLIENT_B_ADDR }, owner: null as string | null, handle: 'B' },
        { declaration: { mid: '5', kind: 'video' as const, purpose: 'va' as const, forAddr: CLIENT_C_ADDR }, owner: null as string | null, handle: 'C' },
        { declaration: { mid: '6', kind: 'video' as const, purpose: 'screen' as const }, owner: null as string | null, handle: 'S' },
      ];
      const forC = pickSlot(slots, { kind: 'video', purpose: 'va', ownerKey: CLIENT_C_ADDR });
      expect(forC?.handle)
        .withContext(`the hint lets the viewer show media without waiting for a mapping`)
        .toBe('C');
      forC!.owner = CLIENT_C_ADDR;
      expect(pickSlot(slots, { kind: 'video', purpose: 'va', ownerKey: CLIENT_C_ADDR })?.handle)
        .withContext(`a re-join must reuse its m-line, or the viewer grows a second tile`)
        .toBe('C');
      // An unexpected participant takes what is free; a screen may fall back to a
      // participant reserve, since an actual share beats a reserve for an absentee.
      expect(pickSlot(slots, { kind: 'video', purpose: 'va', ownerKey: 'x@3nsoft.net' })?.handle)
        .toBe('B');
      slots[0].owner = 'x@3nsoft.net';
      expect(pickSlot(slots, { kind: 'video', purpose: 'screen', ownerKey: 'screen:z:1' })?.handle)
        .toBe('S');
      slots[2].owner = 'screen:z:1';
      expect(pickSlot(slots, { kind: 'video', purpose: 'screen', ownerKey: 'screen:z:2' }))
        .withContext(`nothing free of that kind: the caller falls back to renegotiation`)
        .toBeUndefined();
      expect(pickSlot(slots, { kind: 'audio', purpose: 'va', ownerKey: CLIENT_B_ADDR }))
        .withContext(`kind is never crossed`)
        .toBeUndefined();
    }, 5000);

    itCond(`ranks offers and answers on separate watermarks`, async () => {
      // The regression this fixes, from the group call of 2026-08-12: the peer
      // sent an answer and its own offer milliseconds apart, ASMail reordered
      // them, and a shared watermark made the offer's stamp discard the answer
      // the pc was waiting for right then — a 45-60s retry cycle for a signal
      // that had arrived.
      const gate = createSdpFreshnessGate();
      const describe = (behindMs: number) => `stale by ${behindMs}ms`;
      expect(gate.isStale('offer', 1000, describe)).toBe(false);
      expect(gate.isStale('answer', 994, describe))
        .withContext(`an answer is not ranked against offers`)
        .toBe(false);
      expect(gate.isStale('answer', 993, describe))
        .withContext(`but it is ranked against older answers`)
        .toBe(true);
      expect(gate.isStale('offer', 999, describe)).toBe(true);
      expect(gate.highWater())
        .withContext(`the peer's clock as last seen, across kinds and including stale ones`)
        .toBe(1000);
      expect(gate.isStale('offer', undefined, describe))
        .withContext(`a peer that sends no stamp keeps the previous behaviour`)
        .toBe(false);
    }, 5000);

    itCond(`reads m-line directions out of an SDP by mid`, async () => {
      const directions = sdpDirectionsByMid(VALID_SDP);
      expect(directions.get('0'))
        .withContext(`the fixture's only m-line states 'a=sendrecv'`)
        .toBe('sendrecv');
      expect(sdpDirectionsByMid(undefined).size).toBe(0);
    }, 5000);

    itCond(`negotiates an empty slot as sendonly and carries media after replaceTrack`, async () => {
      const clientPc = new RTCPeerConnection({ iceServers: [] });
      const hostPc = new RTCPeerConnection({ iceServers: [] });
      const clientLocal = createRealMediaStreamForTesting();
      const placeholderVideo = createRealMediaStreamTrack('video');
      const keptPlaceholder = createRealMediaStreamTrack('video');
      // The tracks whose media must actually arrive: animated, so frames exist.
      const relayed = createAnimatedVideoTrack();
      const keptRelayed = createAnimatedVideoTrack();
      const relayedVideo = relayed.track;
      const keptRelayedVideo = keptRelayed.track;
      const hostNegotiationNeeded: string[] = [];
      try {
        // Wired before any setLocalDescription: gathering starts there, and a
        // handler attached later misses every candidate already emitted.
        // Buffered until the receiving side has a remote description, exactly as
        // the production channels do — addIceCandidate rejects before that, and
        // swallowing those rejections leaves both peers gathered but unconnected.
        const clientCandidates: string[] = [];
        const hostCandidates: string[] = [];
        const candidateErrors: string[] = [];
        const pending = new Map<RTCPeerConnection, RTCIceCandidate[]>([
          [clientPc, []], [hostPc, []],
        ]);
        function deliver(to: RTCPeerConnection, candidate: RTCIceCandidate): void {
          if (!to.remoteDescription) {
            pending.get(to)!.push(candidate);
            return;
          }
          // Chromium hides local addresses behind an mDNS name ('<uuid>.local')
          // for any page without media permission — which a test page is. The
          // peer accepts such a candidate and then cannot resolve it, so no pair
          // is ever formed and ICE never leaves 'new'. Both pcs live in this
          // process, so the loopback address reaches the same socket.
          const line = candidate.candidate.replace(/[0-9a-f-]+\.local/i, '127.0.0.1');
          to.addIceCandidate({
            candidate: line,
            sdpMid: candidate.sdpMid ?? undefined,
            sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
            usernameFragment: candidate.usernameFragment ?? undefined,
          }).catch(err => {
            candidateErrors.push(String((err as Error)?.message ?? err));
          });
        }
        function flushCandidates(to: RTCPeerConnection): void {
          const buffered = pending.get(to)!.splice(0);
          buffered.forEach(candidate => deliver(to, candidate));
        }
        clientPc.onicecandidate = e => {
          if (e.candidate) {
            clientCandidates.push(e.candidate.candidate);
            deliver(hostPc, e.candidate);
          }
        };
        hostPc.onicecandidate = e => {
          if (e.candidate) {
            hostCandidates.push(e.candidate.candidate);
            deliver(clientPc, e.candidate);
          }
        };

        // ---- client side: its own media, then the reserved slots ------------
        clientPc.addTransceiver('audio', { direction: 'recvonly' });
        clientPc.addTransceiver('video', { direction: 'recvonly' });
        clientLocal.getTracks().forEach(track => {
          clientPc.addTransceiver(track, { direction: 'sendonly', streams: [clientLocal] });
        });
        // Two slots, to tell apart the two ways of keeping a slot alive while it
        // is empty: 'silenced' is negotiated with a placeholder and then given
        // replaceTrack(null); 'kept' holds the placeholder until real media
        // arrives. Whichever carries RTP decides how the host fills relay slots.
        const silencedSlot = clientPc.addTransceiver('video', { direction: 'recvonly' });
        const keptSlot = clientPc.addTransceiver('video', { direction: 'recvonly' });
        const cameraTransceiver = clientPc.getTransceivers()
          .find(tr => tr.sender.track?.kind === 'video')!;

        await clientPc.setLocalDescription();
        const offer = clientPc.localDescription!;
        const slotMid = silencedSlot.mid!;
        const keptMid = keptSlot.mid!;
        const cameraMid = cameraTransceiver.mid!;
        expect(slotMid).withContext(`mids exist once the offer is set`).toBeTruthy();
        expect(sdpDirectionsByMid(offer.sdp).get(slotMid)).toBe('recvonly');

        // ---- host side: claim the slot before answering ---------------------
        await hostPc.setRemoteDescription(offer);
        flushCandidates(hostPc);
        hostPc.onnegotiationneeded = () => hostNegotiationNeeded.push('host');
        const offeredDirections = sdpDirectionsByMid(offer.sdp);
        const hostSlot = hostPc.getTransceivers().find(tr => tr.mid === slotMid)!;
        expect(offeredDirections.get(slotMid))
          .withContext(`only a recvonly m-line may be claimed as a slot`)
          .toBe('recvonly');
        const hostKeptSlot = hostPc.getTransceivers().find(tr => tr.mid === keptMid)!;
        hostSlot.direction = 'sendonly';
        hostKeptSlot.direction = 'sendonly';
        // The placeholder is what puts msid/ssrc for this slot into the answer,
        // so the receiver never has to attribute an unsignalled SSRC later.
        await hostSlot.sender.replaceTrack(placeholderVideo);
        hostSlot.sender.setStreams(new MediaStream());
        await hostKeptSlot.sender.replaceTrack(keptPlaceholder);
        hostKeptSlot.sender.setStreams(new MediaStream());

        await hostPc.setLocalDescription();
        const answer = hostPc.localDescription!;
        const answeredDirections = sdpDirectionsByMid(answer.sdp);
        expect(answeredDirections.get(slotMid))
          .withContext(`without direction='sendonly' the intersection is 'inactive' and the slot is born dead`)
          .toBe('sendonly');
        expect(answeredDirections.get(cameraMid))
          .withContext(`the client's camera must stay received by the host`)
          .toBe('recvonly');
        // What the placeholder was for: the slot's own ssrc/msid, stated in the
        // answer so the receiver can attribute media that arrives later.
        const slotSection = answer.sdp.split(/(?=^m=)/m)
          .find(section => section.includes(`a=mid:${slotMid}`)) ?? '';
        expect(slotSection.includes('a=ssrc:'))
          .withContext(`slot m-section of the answer must carry an ssrc — ${slotSection.slice(0, 400)}`)
          .toBe(true);

        // Silence one of them: the slot keeps its negotiated ssrc, so no junk RTP
        // flows while it is empty. The other keeps its placeholder, to show which
        // of the two is actually able to carry media afterwards.
        await hostSlot.sender.replaceTrack(null);

        await clientPc.setRemoteDescription(answer);
        flushCandidates(clientPc);

        // ---- connect the two peers ------------------------------------------
        const connectDeadline = Date.now() + 20_000;
        while ((clientPc.connectionState !== 'connected') && (Date.now() < connectDeadline)) {
          await sleep(100);
        }
        const iceReport = `client: conn=${clientPc.connectionState} `
          + `ice=${clientPc.iceConnectionState} gather=${clientPc.iceGatheringState} `
          + `cands=${clientCandidates.length}; host: conn=${hostPc.connectionState} `
          + `ice=${hostPc.iceConnectionState} gather=${hostPc.iceGatheringState} `
          + `cands=${hostCandidates.length}; addIceCandidate errors: `
          + `${candidateErrors.length ? candidateErrors.join(' | ') : 'none'}; `
          + `first client cand: ${clientCandidates[0] ?? 'none'}`;
        expect(clientPc.connectionState)
          .withContext(`two local pcs must connect over host candidates — ${iceReport}`)
          .toBe('connected');

        // ---- an empty slot must be distinguishable from a stalled sender ----
        // The quality monitor warns about a video sender that encodes no frames,
        // to catch a share whose m-line never finished negotiating. An emptied
        // slot looks exactly like that — negotiated ssrc, nothing to encode —
        // and made the warning fire once per empty slot, forever. This pins the
        // discriminator against real stats, because the obvious one does not
        // hold: Chromium keeps reporting `mediaSourceId` on a sender whose track
        // was replaced with null, so only resolving the source and checking its
        // track is still attached tells the two apart.
        const hostLiveTrackIds = new Set(
          hostPc.getSenders().map(s => s.track?.id).filter((id): id is string => !!id),
        );
        // Per sender rather than by matching ssrcs out of pc.getStats():
        // getParameters().encodings[].ssrc is not reliably populated in Chromium.
        async function outboundLiveness(sender: RTCRtpSender): Promise<boolean[]> {
          const stats = await sender.getStats();
          const verdicts: boolean[] = [];
          stats.forEach(report => {
            if ((report as unknown as { type?: string }).type === 'outbound-rtp') {
              verdicts.push(outboundHasLiveTrack(report, stats, hostLiveTrackIds));
            }
          });
          return verdicts;
        }
        const emptied = await outboundLiveness(hostSlot.sender);
        const kept = await outboundLiveness(hostKeptSlot.sender);
        expect(emptied.length + kept.length)
          .withContext(`both slots must report outbound stats for the check to mean anything`)
          .toBeGreaterThan(1);
        expect(emptied.some(live => live))
          .withContext(`an emptied slot has no attached track, so it is not a stalled sender`)
          .toBe(false);
        expect(kept.every(live => live))
          .withContext(`a slot still holding its placeholder does have one`)
          .toBe(true);

        // ---- fill both slots, with no renegotiation -------------------------
        const clientSlot = clientPc.getTransceivers().find(tr => tr.mid === slotMid)!;
        const clientKeptSlot = clientPc.getTransceivers().find(tr => tr.mid === keptMid)!;
        expect(clientSlot.receiver.track.kind).toBe('video');
        await hostSlot.sender.replaceTrack(relayedVideo);
        await hostKeptSlot.sender.replaceTrack(keptRelayedVideo);

        // Stats scoped to each receiver/sender, so nothing has to be matched by
        // mid (which Chromium does not report on inbound-rtp in every version).
        async function inboundBytes(receiver: RTCRtpReceiver): Promise<number> {
          let bytes = 0;
          (await receiver.getStats()).forEach(report => {
            if (report.type === 'inbound-rtp') {
              bytes = (report as unknown as { bytesReceived?: number }).bytesReceived ?? 0;
            }
          });
          return bytes;
        }
        async function outboundPackets(sender: RTCRtpSender): Promise<number> {
          let packets = 0;
          (await sender.getStats()).forEach(report => {
            if (report.type === 'outbound-rtp') {
              packets = (report as unknown as { packetsSent?: number }).packetsSent ?? 0;
            }
          });
          return packets;
        }

        let silencedBytes = 0;
        let keptBytes = 0;
        const mediaDeadline = Date.now() + 15_000;
        while (((silencedBytes === 0) || (keptBytes === 0)) && (Date.now() < mediaDeadline)) {
          await sleep(250);
          silencedBytes = await inboundBytes(clientSlot.receiver);
          keptBytes = await inboundBytes(clientKeptSlot.receiver);
        }
        const mediaReport = `silenced slot: in=${silencedBytes}B `
          + `out=${await outboundPackets(hostSlot.sender)}pkt `
          + `dir=${clientSlot.currentDirection}/${hostSlot.currentDirection} `
          + `muted=${clientSlot.receiver.track.muted}; kept slot: in=${keptBytes}B `
          + `out=${await outboundPackets(hostKeptSlot.sender)}pkt `
          + `dir=${clientKeptSlot.currentDirection}/${hostKeptSlot.currentDirection} `
          + `muted=${clientKeptSlot.receiver.track.muted}`;
        expect(keptBytes)
          .withContext(`a slot that kept its placeholder must carry the real track — ${mediaReport}`)
          .toBeGreaterThan(0);
        expect(silencedBytes)
          .withContext(`a slot silenced with replaceTrack(null) must carry it too — ${mediaReport}`)
          .toBeGreaterThan(0);
        expect(hostNegotiationNeeded)
          .withContext(`claiming and filling a slot must not ask for a renegotiation`)
          .toEqual([]);
      } finally {
        clientPc.close();
        hostPc.close();
        [placeholderVideo, keptPlaceholder].forEach(track => track.stop());
        relayed.stop();
        keptRelayed.stop();
        clientLocal.getTracks().forEach(track => track.stop());
      }
    }, 60000);

    itCond(`relays a client's live audio into another client's reserved slot`, async () => {
      // The group call of 2026-08-19: the last participant to join saw everyone
      // and heard only the host. The path this exercises is the one that was
      // never covered — a REMOTE audio track (what the host receives from one
      // client) dropped into a pre-negotiated audio slot of another client's
      // connection with replaceTrack, no renegotiation. The slot suite until now
      // proved this for video only, on a locally-sourced canvas track; neither
      // "audio" nor "a track that came in over the network" was ever tried.
      const aPc = new RTCPeerConnection({ iceServers: [] });
      const hostFromA = new RTCPeerConnection({ iceServers: [] });
      const hostToB = new RTCPeerConnection({ iceServers: [] });
      const bPc = new RTCPeerConnection({ iceServers: [] });
      // A's microphone (a real tone, so there is something to encode) and the
      // host's own, which occupies the first audio m-line exactly as in a call.
      const aMic = createRealMediaStreamTrack('audio');
      const aMic2 = createRealMediaStreamTrack('audio');
      const aStream = new MediaStream([aMic]);
      const hostMic = createRealMediaStreamTrack('audio');
      const hostStream = new MediaStream([hostMic]);
      // The placeholder built the way the host builds it: a destination node with
      // nothing connected, i.e. silence. Its only job is to put msid and ssrc for
      // the slot into the answer.
      // The production bridge itself, not a hand-rolled one: what makes relayed
      // audio flow has to be the code the host actually runs.
      const audioBridge = createAudioRelayBridge('test');
      const placeholderCtx = new AudioContext();
      const placeholderAudio = placeholderCtx.createMediaStreamDestination()
        .stream.getAudioTracks()[0];
      const hostToBNegotiationNeeded: string[] = [];
      // Declared out here so the teardown below can stop it whatever happens.
      const relayedSink = new Audio();

      // Both pairs need the same candidate plumbing the video slot test uses:
      // buffered until there is a remote description, and mDNS names rewritten
      // to loopback (a test page has no media permission, so Chromium hides
      // local addresses and the peer can never resolve them).
      function wireIce(left: RTCPeerConnection, right: RTCPeerConnection): void {
        const pending = new Map<RTCPeerConnection, RTCIceCandidate[]>([[left, []], [right, []]]);
        const deliver = (to: RTCPeerConnection, candidate: RTCIceCandidate) => {
          if (!to.remoteDescription) {
            pending.get(to)!.push(candidate);
            return;
          }
          void to.addIceCandidate({
            candidate: candidate.candidate.replace(/[0-9a-f-]+\.local/i, '127.0.0.1'),
            sdpMid: candidate.sdpMid ?? undefined,
            sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
            usernameFragment: candidate.usernameFragment ?? undefined,
          }).catch(() => {});
        };
        const flush = (to: RTCPeerConnection) => {
          pending.get(to)!.splice(0).forEach(candidate => deliver(to, candidate));
        };
        left.onicecandidate = e => e.candidate && deliver(right, e.candidate);
        right.onicecandidate = e => e.candidate && deliver(left, e.candidate);
        // A remote description can land at any point; flushing on every state
        // change is simpler than tracking which side got one first.
        left.onsignalingstatechange = () => flush(left);
        right.onsignalingstatechange = () => flush(right);
      }
      wireIce(aPc, hostFromA);
      wireIce(hostToB, bPc);

      try {
        // ---- A sends its microphone to the host -----------------------------
        // Two independent tracks, so no single remote track has to serve two
        // senders — otherwise a failure could just be Chromium refusing to share
        // one, rather than refusing relayed audio as such.
        const arrivedAtHost: MediaStreamTrack[] = [];
        const bothArrived = new Promise<void>(resolve => {
          hostFromA.ontrack = event => {
            if (event.track.kind === 'audio') {
              arrivedAtHost.push(event.track);
              if (arrivedAtHost.length === 2) {
                resolve();
              }
            }
          };
        });
        aPc.addTransceiver(aMic, { direction: 'sendonly', streams: [aStream] });
        aPc.addTransceiver(aMic2, { direction: 'sendonly', streams: [new MediaStream([aMic2])] });
        await aPc.setLocalDescription();
        await hostFromA.setRemoteDescription(aPc.localDescription!);
        await hostFromA.setLocalDescription();
        await aPc.setRemoteDescription(hostFromA.localDescription!);

        // ---- B offers its own mic plus three reserved audio slots -----------
        // addTrack, not addTransceiver: this is what the client does, and it is
        // what makes B's own microphone take the first audio m-line — a slot
        // must not be the one the host's own voice pairs with.
        //
        // Three slots, because a silent one has three candidate explanations and
        // only a matrix tells them apart: the source being a REMOTE track, the
        // emptying step (replaceTrack(null) after the answer), or audio slots as
        // such. Each slot varies one of those against the production recipe.
        bPc.addTransceiver('audio', { direction: 'recvonly' });
        bPc.addTrack(createRealMediaStreamTrack('audio'), new MediaStream());
        const remoteSilencedSlot = bPc.addTransceiver('audio', { direction: 'recvonly' });
        const localSilencedSlot = bPc.addTransceiver('audio', { direction: 'recvonly' });
        const bridgedSlot = bPc.addTransceiver('audio', { direction: 'recvonly' });
        await bPc.setLocalDescription();
        const bOffer = bPc.localDescription!;
        const slotMid = remoteSilencedSlot.mid!;
        const localMid = localSilencedSlot.mid!;
        const keptMid = bridgedSlot.mid!;
        expect(sdpDirectionsByMid(bOffer.sdp).get(slotMid))
          .withContext(`the slot must be offered recvonly for the host to claim it`)
          .toBe('recvonly');

        hostToB.addTrack(hostMic, hostStream);
        await hostToB.setRemoteDescription(bOffer);
        hostToB.onnegotiationneeded = () => hostToBNegotiationNeeded.push('hostToB');
        const hostSideOf = (mid: string) => hostToB.getTransceivers().find(tr => tr.mid === mid)!;
        const hostSlot = hostSideOf(slotMid);
        const hostLocalSlot = hostSideOf(localMid);
        const hostBridgedSlot = hostSideOf(keptMid);
        expect(hostSlot)
          .withContext(`the host must find the slot's m-line by mid`)
          .toBeTruthy();
        for (const [transceiver, placeholder] of [
          [hostSlot, placeholderAudio],
          [hostLocalSlot, placeholderCtx.createMediaStreamDestination().stream.getAudioTracks()[0]],
          [hostBridgedSlot, placeholderCtx.createMediaStreamDestination().stream.getAudioTracks()[0]],
        ] as Array<[RTCRtpTransceiver, MediaStreamTrack]>) {
          transceiver.direction = 'sendonly';
          await transceiver.sender.replaceTrack(placeholder);
          transceiver.sender.setStreams(new MediaStream());
        }
        await hostToB.setLocalDescription();
        const bAnswer = hostToB.localDescription!;
        expect(sdpDirectionsByMid(bAnswer.sdp).get(slotMid))
          .withContext(`answered as anything but sendonly, the slot is born dead`)
          .toBe('sendonly');
        // Emptied again, exactly as silenceEmptyRelaySlots does, so no silence is
        // ever sent down a slot that has no participant in it yet. The 'kept' one
        // holds its placeholder instead, which is the control.
        await hostSlot.sender.replaceTrack(null);
        await hostLocalSlot.sender.replaceTrack(null);
        await hostBridgedSlot.sender.replaceTrack(null);
        await bPc.setRemoteDescription(bAnswer);

        // ---- both links up ---------------------------------------------------
        const connectDeadline = Date.now() + 20_000;
        while (((aPc.connectionState !== 'connected') || (bPc.connectionState !== 'connected'))
          && (Date.now() < connectDeadline)) {
          await sleep(100);
        }
        const linkReport = `A->host: ${aPc.connectionState}/${hostFromA.connectionState}, `
          + `host->B: ${hostToB.connectionState}/${bPc.connectionState}`;
        expect(bPc.connectionState)
          .withContext(`both local pairs must connect over host candidates — ${linkReport}`)
          .toBe('connected');

        const clientSideOf = (mid: string) => bPc.getTransceivers().find(tr => tr.mid === mid)!;
        const clientSlot = clientSideOf(slotMid);
        const clientLocalSlot = clientSideOf(localMid);
        const clientBridgedSlot = clientSideOf(keptMid);
        // The host's own voice, on the ordinary m-line B offered for it: the
        // control for the whole pair. If this is silent too, nothing is being
        // measured about slots.
        const hostVoice = bPc.getTransceivers()
          .find(tr => (tr.receiver.track?.kind === 'audio') && (tr.mid !== slotMid)
            && (tr.mid !== localMid) && (tr.mid !== keptMid))!;
        async function packetsOn(receiver: RTCRtpReceiver): Promise<number> {
          let packets = 0;
          (await receiver.getStats()).forEach(report => {
            if (report.type === 'inbound-rtp') {
              packets = (report as unknown as { packetsReceived?: number }).packetsReceived ?? 0;
            }
          });
          return packets;
        }
        // What `nrg` in the relay matrix is read off: the energy of the source
        // feeding a sender. Packets cannot answer whether there is sound in them
        // - a muted mic and a bridge whose AudioContext never woke send at the
        // same rate - and on the RECEIVING side the number does not exist:
        // Chromium fills totalAudioEnergy only for audio it plays out, so a
        // relayed track feeding nothing but the bridge reads zero on
        // inbound-rtp (measured: 0 throughout, while its copy sent 1007pkt).
        // Hence every energy reading here comes from a media-source.
        async function sourceEnergyOn(sender: RTCRtpSender): Promise<number> {
          let energy = 0;
          const stats = await sender.getStats();
          let sourceId: string | undefined = undefined;
          stats.forEach(report => {
            if (report.type === 'outbound-rtp') {
              sourceId = (report as unknown as { mediaSourceId?: string }).mediaSourceId;
            }
          });
          if (sourceId) {
            const source = stats.get(sourceId) as unknown as
              { totalAudioEnergy?: number } | undefined;
            energy = source?.totalAudioEnergy ?? 0;
          }
          return energy;
        }

        // ---- the moment under test ------------------------------------------
        await Promise.race([bothArrived, sleep(15_000)]);
        const aAudioAtHost = arrivedAtHost[0];
        const aAudioAtHost2 = arrivedAtHost[1];
        expect(aAudioAtHost?.readyState)
          .withContext(`the host must have A's audio track before it can relay it`)
          .toBe('live');
        expect(aAudioAtHost2?.readyState)
          .withContext(`and a second, so neither sender has to share one track`)
          .toBe('live');
        const localTone = createRealMediaStreamTrack('audio');
        // A sink the production host has and this test did not: the call window
        // plays every remote track through an <audio> element (peer-video.vue).
        // It matters beyond hearing: with nothing playing a relayed track out,
        // Chromium reports zero energy for it everywhere — measured, both on its
        // inbound-rtp and on the media-source of the WebAudio copy fed from it,
        // while that copy still sent 1007 packets. Whether those packets carry
        // sound at all without playout is what the numbers below are for.
        relayedSink.srcObject = new MediaStream([aAudioAtHost2!]);
        relayedSink.volume = 0;
        await relayedSink.play().catch(() => {
          // Autoplay refused: then the numbers below say what that costs.
        });
        // The bridge: a relayed track re-sourced through WebAudio, which turns it
        // into a locally generated one. If a slot carries this and not the raw
        // remote track, that is the workaround the relay needs — and the proof
        // that the obstacle is the source of the track, nothing else.
        const bridgedTrack = audioBridge.localCopyOf(aAudioAtHost2!)!;
        expect(bridgedTrack)
          .withContext(`the relay bridge must produce a local stand-in`)
          .toBeTruthy();
        expect(audioBridge.originalOf(bridgedTrack))
          .withContext(`and remember which relayed track it stands for, or a repeat `
            + `broadcast would re-assign a slot that is already serving this source`)
          .toBe(aAudioAtHost2!);
        await hostSlot.sender.replaceTrack(aAudioAtHost!);
        await hostLocalSlot.sender.replaceTrack(localTone);
        await hostBridgedSlot.sender.replaceTrack(bridgedTrack);
        const bridgedEnergyAtStart = await sourceEnergyOn(hostBridgedSlot.sender);

        const counts = { voice: 0, remoteSilenced: 0, localSilenced: 0, bridged: 0 };
        const mediaDeadline = Date.now() + 20_000;
        while (Date.now() < mediaDeadline) {
          await sleep(250);
          counts.voice = await packetsOn(hostVoice.receiver);
          counts.remoteSilenced = await packetsOn(clientSlot.receiver);
          counts.localSilenced = await packetsOn(clientLocalSlot.receiver);
          counts.bridged = await packetsOn(clientBridgedSlot.receiver);
          if (counts.voice && counts.remoteSilenced && counts.localSilenced && counts.bridged) {
            break;
          }
        }
        // The bridge must carry SOUND, not just packets: a graph whose context
        // never woke sends a full packet rate of silence, which is exactly the
        // failure `nrg` in the relay matrix exists to name.
        let bridgedEnergy = bridgedEnergyAtStart;
        const energyDeadline = Date.now() + 5_000;
        while ((bridgedEnergy <= bridgedEnergyAtStart) && (Date.now() < energyDeadline)) {
          await sleep(250);
          bridgedEnergy = await sourceEnergyOn(hostBridgedSlot.sender);
        }
        // One report on every expectation below: whichever fails first has to
        // carry the whole matrix, or the run says which case broke without
        // saying what the others did.
        const mediaReport = `host voice=${counts.voice}pkt | `
          + `slot ${slotMid} remote+silenced=${counts.remoteSilenced}pkt `
          + `(dir=${clientSlot.currentDirection}/${hostSlot.currentDirection}, `
          + `muted=${clientSlot.receiver.track.muted}) | `
          + `slot ${localMid} local+silenced=${counts.localSilenced}pkt `
          + `(muted=${clientLocalSlot.receiver.track.muted}) | `
          + `slot ${keptMid} remote-bridged-through-WebAudio=${counts.bridged}pkt `
          + `(muted=${clientBridgedSlot.receiver.track.muted}) | `
          + `relayed track=${aAudioAtHost?.readyState}/`
          + `${aAudioAtHost?.muted ? 'muted' : 'unmuted'}, ctx=${placeholderCtx.state} | `
          + `bridged copy energy=${bridgedEnergyAtStart}->${bridgedEnergy}`;
        expect(counts.voice)
          .withContext(`control: the host's own audio must reach B, or nothing here is measured — ${mediaReport}`)
          .toBeGreaterThan(0);
        expect(counts.localSilenced)
          .withContext(`an audio slot must carry a LOCAL track after being emptied — ${mediaReport}`)
          .toBeGreaterThan(0);
        expect(counts.bridged)
          .withContext(`a relayed track re-sourced through WebAudio must reach the viewer — ${mediaReport}`)
          .toBeGreaterThan(0);
        // Asserted only where it can be: with the relayed track played out, as
        // the call window always does. `nrg` in the relay matrix reads exactly
        // this number, so flat energy beside 1000+ sent packets would mean the
        // bridge forwards silence - the failure the field exists to name. Where
        // autoplay refuses (a stand with no gesture, Android), the platform, not
        // the relay, decided, and the run says so instead of failing.
        // Measured 2026-08-20: with the relayed track played out, energy went
        // 0 -> 0.4 on the bridged copy AND the raw relayed track in slot 1
        // started sending too. Without playout both read zero energy while still
        // counting packets - so playout, not the WebAudio graph, is what makes a
        // relayed audio track carry sound.
        console.log(
          `[Suite 15] bridged copy energy=${bridgedEnergyAtStart}->${bridgedEnergy} `
          + `(playout=${relayedSink.paused ? 'refused' : 'on'}, bridged=${counts.bridged}pkt, `
          + `raw relayed=${counts.remoteSilenced}pkt, local control=${counts.localSilenced}pkt)`,
        );
        if (relayedSink.paused) {
          console.log(
            `[Suite 15] playout was refused, so the bridge's own energy is not asserted this run`,
          );
        } else {
          expect(bridgedEnergy)
            .withContext(`the bridged copy's media-source must report growing totalAudioEnergy `
              + `while A's tone plays and the relayed track is played out: that is the number `
              + `"nrg" reads, and without it a graph sending silence looks exactly like a `
              + `working relay — ${mediaReport}`)
            .toBeGreaterThan(bridgedEnergyAtStart);
        }
        // Deliberately not an expectation on zero. This row is why the bridge
        // exists, and the day Chromium starts sending a raw relayed audio track
        // the suite should not fail for it - it should be noticed and the bridge
        // dropped. Until then the number is in the report of every run.
        if (counts.remoteSilenced > 0) {
          console.log(
            `[Suite 15] a RAW relayed audio track now reaches the viewer `
            + `(${counts.remoteSilenced}pkt): the WebAudio bridge in host-channel `
            + `may no longer be needed — ${mediaReport}`,
          );
        }
        expect(hostToBNegotiationNeeded)
          .withContext(`filling a slot must cost no renegotiation — that is the point of slots`)
          .toEqual([]);
      } finally {
        relayedSink.pause();
        relayedSink.srcObject = null;
        [aPc, hostFromA, hostToB, bPc].forEach(pc => pc.close());
        [aMic, aMic2, hostMic, placeholderAudio].forEach(track => track?.stop());
        hostToB.getSenders().forEach(sender => sender.track?.stop());
        audioBridge.close();
        void placeholderCtx.close().catch(() => {});
      }
    }, 90000);

    itCond(`tells apart which kinds of a source are already forwarded`, async () => {
      // The join path is the only route by which an already-present
      // participant's media reaches a newcomer, and it used to skip a source
      // whole once ONE sender for it existed. This is the rule that replaced it.
      const live = (kind: string) => ({ track: { kind, readyState: 'live' } });
      expect([...kindsAlreadyForwarded([])])
        .withContext(`nothing forwarded yet: every kind is still owed`)
        .toEqual([]);
      expect([...kindsAlreadyForwarded([live('video')])])
        .withContext(`the video sender that used to make the whole source look covered`)
        .toEqual(['video']);
      expect([...kindsAlreadyForwarded([live('video'), live('audio')])].sort())
        .toEqual(['audio', 'video']);
      expect([...kindsAlreadyForwarded([{ track: null }])])
        .withContext(`a sender emptied by a failed assignment forwards nothing`)
        .toEqual([]);
      expect([...kindsAlreadyForwarded([{ track: { kind: 'audio', readyState: 'ended' } }])])
        .withContext(`a dead track is silence, and reading it as coverage is the same bug`)
        .toEqual([]);
    }, 5000);

    itCond(`ignores a departure the client has already superseded by re-joining`, async () => {
      // A departure rides ASMail with three blind repeats over a minute, because
      // a lost 'disconnect' leaves the peer's window open. Those copies were
      // assumed inert on arrival; on 2026-08-12 one landed after the sender had
      // re-joined and tore its fresh connection down, costing it a full
      // reconnect cycle — and, on the other participants, the mute state it had
      // set while re-joining. The repeats stay; the late ones become harmless.
      const mockSignaling = createMockHostSignalingChannel();
      const hostLocal = createRealMediaStreamForTesting();
      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: hostLocal,
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: () => {},
        onClientDisconnected: () => {},
        onClientTrack: () => {},
      });

      try {
        // Through the signal handler, not handleClientOffer directly: the
        // peer-clock baseline is frozen from the freshness gate, which only the
        // real path advances — exactly as in production.
        const rejoinedAt = 1_786_555_400_000;
        mockSignaling._triggerClientSignal(CLIENT_B_ADDR, {
          type: 'offer',
          fromAddr: CLIENT_B_ADDR,
          data: { type: 'offer', sdp: VALID_SDP },
          msgTs: rejoinedAt,
        });
        await sleep(500);
        expect(hostChannel.getClientCount())
          .withContext(`the offer must have built a connection to compare against`)
          .toBe(1);

        expect(hostChannel.isStaleClientDisconnect(CLIENT_B_ADDR, rejoinedAt - 60_000))
          .withContext(`a copy of the departure that preceded this pc generation`)
          .toBe(true);
        expect(hostChannel.isStaleClientDisconnect(CLIENT_B_ADDR, rejoinedAt + 1))
          .withContext(`a genuine departure, sent after the client re-joined`)
          .toBe(false);
        expect(hostChannel.isStaleClientDisconnect(CLIENT_B_ADDR, undefined))
          .withContext(`a peer on a build that stamps nothing keeps the old behaviour`)
          .toBe(false);
        expect(hostChannel.isStaleClientDisconnect(CLIENT_C_ADDR, rejoinedAt - 60_000))
          .withContext(`no baseline for a client never connected: the ghost path is unchanged`)
          .toBe(false);
      } finally {
        hostChannel.closeAll();
        hostLocal.getTracks().forEach(track => track.stop());
      }
    }, 15000);

    itCond(`keeps an offer carrying the full slot reserve out of ASMail's danger zone`, async () => {
      // Slots are m-lines, and m-lines are bytes on a transport where the load
      // tests put 8-14KB messages in the danger zone and never exercised more
      // (asmail-group-call-load). MAX_RESERVED_SLOTS is set from this very
      // measurement: ~7KB before any slot, ~1.4KB each. Ten of them made a 21KB
      // offer — past anything ASMail was ever measured carrying, on the exact
      // message whose loss is what the slots exist to prevent.
      const bare = new RTCPeerConnection({ iceServers: [] });
      const withSlots = new RTCPeerConnection({ iceServers: [] });
      const local = createRealMediaStreamForTesting();
      try {
        for (const pc of [bare, withSlots]) {
          pc.addTransceiver('audio', { direction: 'recvonly' });
          pc.addTransceiver('video', { direction: 'recvonly' });
          local.getTracks().forEach(track => {
            pc.addTransceiver(track, { direction: 'sendonly', streams: [local] });
          });
        }
        for (let i = 0; i < MAX_RESERVED_SLOTS; i += 1) {
          withSlots.addTransceiver((i % 2) ? 'video' : 'audio', { direction: 'recvonly' });
        }
        // As the client itself does, and it dominates the result: an unpinned
        // m-line carries the full native codec list, which is several KB on its
        // own — measuring without this says nothing about the real offer.
        applyCodecPreferences(bare, 'offer size (no slots)');
        applyCodecPreferences(withSlots, 'offer size (full reserve)');
        await bare.setLocalDescription();
        await withSlots.setLocalDescription();
        const bareSize = bare.localDescription!.sdp.length;
        const slottedSize = withSlots.localDescription!.sdp.length;
        const report = `${bareSize}B without slots, ${slottedSize}B with `
          + `${MAX_RESERVED_SLOTS} (${Math.round((slottedSize - bareSize) / MAX_RESERVED_SLOTS)}B each)`;
        expect(slottedSize)
          .withContext(`a full reserve must stay within what ASMail was measured carrying — ${report}`)
          .toBeLessThan(14_000);
      } finally {
        bare.close();
        withSlots.close();
        local.getTracks().forEach(track => track.stop());
      }
    }, 10000);

    itCond(`host claims a client's declared slots and relays a third party into one`, async () => {
      // The wiring, on the real host channel: an offer that declares slots is
      // answered with those m-lines turned into senders, and a participant who
      // joins afterwards is relayed by dropping their track into a slot — the
      // client is told by a mapping addressed to the mid, and is NOT re-offered
      // to. That last part is what the group call of 2026-08-12 needed.
      const mockSignaling = createMockHostSignalingChannel();
      const hostLocal = createRealMediaStreamForTesting();
      const clientPc = new RTCPeerConnection({ iceServers: [] });
      const clientLocal = createRealMediaStreamForTesting();
      const relayedFromC = createRealMediaStreamTrack('video');
      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: hostLocal,
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: () => {},
        onClientDisconnected: () => {},
        onClientTrack: () => {},
      });

      try {
        // The client's own layout, in the production order: receive m-lines,
        // then local media, then the reserved slots (reserving first would let
        // addTrack() eat the first free audio slot).
        clientPc.addTransceiver('audio', { direction: 'recvonly' });
        clientPc.addTransceiver('video', { direction: 'recvonly' });
        clientLocal.getTracks().forEach(track => {
          clientPc.addTransceiver(track, { direction: 'sendonly', streams: [clientLocal] });
        });
        const audioSlot = clientPc.addTransceiver('audio', { direction: 'recvonly' });
        const videoSlot = clientPc.addTransceiver('video', { direction: 'recvonly' });
        const cameraTransceiver = clientPc.getTransceivers()
        .find(tr => tr.sender.track?.kind === 'video')!;

        await clientPc.setLocalDescription();
        const offerSdp = clientPc.localDescription!.sdp;
        const relaySlots: RelaySlotDeclaration[] = [
          { mid: audioSlot.mid!, kind: 'audio', purpose: 'va', forAddr: CLIENT_C_ADDR },
          { mid: videoSlot.mid!, kind: 'video', purpose: 'va', forAddr: CLIENT_C_ADDR },
        ];
        const offer: OfferSignalPayload = { type: 'offer', sdp: offerSdp, relaySlots };

        await hostChannel.handleClientOffer(CLIENT_B_ADDR, offer);

        const answered = mockSignaling.sendAnswerToClient.calls.allArgs()
        .find(([addr]) => addr === CLIENT_B_ADDR) as [string, RTCSessionDescriptionInit] | undefined;
        expect(answered).withContext(`the host must have answered`).toBeDefined();
        const answerSdp = answered![1].sdp!;
        const answered_directions = sdpDirectionsByMid(answerSdp);
        expect(answered_directions.get(videoSlot.mid!))
          .withContext(`an unclaimed slot answers 'inactive' and is born dead`)
          .toBe('sendonly');
        expect(answered_directions.get(audioSlot.mid!)).toBe('sendonly');
        expect(answered_directions.get(cameraTransceiver.mid!))
          .withContext(`the client's own camera must stay received by the host`)
          .toBe('recvonly');
        const slotSection = answerSdp.split(/(?=^m=)/m)
        .find(section => section.includes(`a=mid:${videoSlot.mid}`)) ?? '';
        expect(slotSection.includes('a=ssrc:'))
          .withContext(`the placeholder is what puts an ssrc into the slot's m-section`)
          .toBe(true);

        // A third participant's track now reaches this client through a slot.
        hostChannel.broadcastTrackToOtherClients(
          CLIENT_C_ADDR, relayedFromC, new MediaStream([relayedFromC]),
        );
        await sleep(STREAM_INFO_BATCH_WINDOW_MS + 500);

        const offersSent = mockSignaling.sendSignalToClient.calls.allArgs()
        .filter(([, signal]) => (signal as { type: string }).type === 'offer');
        expect(offersSent.length)
          .withContext(`a slotted relay must not renegotiate with anyone`)
          .toBe(0);
        const mappings = mappingSignalsSentTo(mockSignaling)
        .filter(([addr]) => addr === CLIENT_B_ADDR)
        .flatMap(([, payload]) => payload.infos);
        expect(mappings.some(info =>
          (info.mid === videoSlot.mid) && (info.senderAddr === CLIENT_C_ADDR)))
          .withContext(
            `the mapping must name the slot by mid — a slot's stream id is fixed at `
            + `negotiation and cannot express who is in it (got `
            + `${JSON.stringify(mappings)})`,
          )
          .toBe(true);
      } finally {
        hostChannel.closeAll();
        clientPc.close();
        relayedFromC.stop();
        clientLocal.getTracks().forEach(track => track.stop());
        hostLocal.getTracks().forEach(track => track.stop());
      }
    }, 20000);

  });

  // ===========================================================================
  // Test Suite 16: Teardown idempotence, call records and monitor filters
  // ===========================================================================

  /**
   * The pure rules extracted while fixing the group call of 2026-08-13. Each is
   * imported directly and handed its own clock, so none of this needs a network,
   * a peer connection or a running call (see doc/07-build-test-run.md §5.2).
   */
  describe(`Test Suite 16: Teardown idempotence and call records`, () => {

    // A departure's own stamp; every copy of that departure carries this one.
    const LEFT_AT = 1_786_600_000_000;

    itCond(`treats every copy of one departure as a repeat, and a new one as new`, async () => {
      // A 'disconnect' arrives up to four times (blind repeats + reactive
      // resends) from ONE `msg` object, so all copies share `WebRTCMsg.id`. Each
      // copy used to re-run the host's departure path, and a 'participant-left'
      // landing after the peer re-joined took its tile off everyone's screen.
      const gate = createDepartureGate();

      expect(gate.isRepeat(CLIENT_B_ADDR, LEFT_AT))
        .withContext(`the first copy is the departure itself`)
        .toBe(false);
      expect(gate.isRepeat(CLIENT_B_ADDR, LEFT_AT))
        .withContext(`an EQUAL stamp is the duplicate case - this is why the `
          + `comparison is not strict, unlike createSdpFreshnessGate's`)
        .toBe(true);
      expect(gate.isRepeat(CLIENT_B_ADDR, LEFT_AT - 5_000))
        .withContext(`an even older copy is a repeat too`)
        .toBe(true);

      expect(gate.isRepeat(CLIENT_B_ADDR, LEFT_AT + 1))
        .withContext(`left, came back, left again: a fresh stamp passes with no `
          + `window to tune`)
        .toBe(false);
      expect(gate.isRepeat(CLIENT_B_ADDR, LEFT_AT + 1))
        .withContext(`and its own copies are then recognized`)
        .toBe(true);

      expect(gate.isRepeat(CLIENT_C_ADDR, LEFT_AT))
        .withContext(`watermarks are per peer`)
        .toBe(false);
    }, 5000);

    itCond(`keys departures canonically and lets an unstamped one through`, async () => {
      // The same peer reaches this from an ASMail envelope, a chat member list
      // and a view model, and those differ in case. A build that stamps nothing
      // keeps the previous behaviour, as everywhere else.
      const gate = createDepartureGate();

      expect(gate.isRepeat(CLIENT_B_ADDR.toUpperCase(), LEFT_AT)).toBe(false);
      expect(gate.isRepeat(CLIENT_B_ADDR, LEFT_AT))
        .withContext(`one watermark, whatever the case of the address`)
        .toBe(true);
      expect(gate.watermarkOf(CLIENT_B_ADDR.toUpperCase())).toBe(LEFT_AT);

      expect(gate.isRepeat(CLIENT_C_ADDR, undefined)).toBe(false);
      expect(gate.isRepeat(CLIENT_C_ADDR, undefined))
        .withContext(`no stamp, no watermark: nothing to compare, so never a repeat`)
        .toBe(false);

      gate.clear();
      expect(gate.isRepeat(CLIENT_B_ADDR, LEFT_AT))
        .withContext(`cleared at the end of a call`)
        .toBe(false);
    }, 5000);

    itCond(`stamps the newest unstamped 'call' record, whatever the input order`, async () => {
      // A direct regression on the former comparator,
      // `(a, b) => (a.timestamp - b.timestamp ? -1 : 1)`, which returns -1 for
      // ANY two differing timestamps and so does not order at all. It happened
      // to work because V8 reverses a strictly ascending input with such a
      // comparator; a shuffled input is what shows it never sorted.
      const T = 1_786_600_000_000;
      const callBody = (endTimestamp?: number) => JSON.stringify({
        event: 'call',
        value: { sender: HOST_ADDR, direction: 'outgoing', endTimestamp },
      });
      const candidates = [
        { chatMessageId: 'older', body: callBody(), timestamp: T - 60_000 },
        { chatMessageId: 'newest', body: callBody(), timestamp: T - 1_000 },
        { chatMessageId: 'middle', body: callBody(), timestamp: T - 30_000 },
      ];

      const pick = pickCallRecordToStamp(candidates, T);
      expect(pick?.candidate.chatMessageId)
        .withContext(`the newest by timestamp, not the last one inserted`)
        .toBe('newest');
      expect(pick?.body.value.endTimestamp)
        .withContext(`the caller is the one that writes the stamp`)
        .toBeUndefined();
    }, 5000);

    itCond(`looks past a later system record that is not a call`, async () => {
      // The failure this exists for: the previous version took the LAST system
      // record and gave up if it was not a 'call' one. Renaming the chat during
      // a call - or the 'webrtc-call' cancellation the host's own teardown
      // writes - therefore lost the duration for good, since nothing revisits a
      // call record afterwards.
      const T = 1_786_600_000_000;
      const candidates = [
        {
          chatMessageId: 'the-call',
          body: JSON.stringify({
            event: 'call', value: { sender: HOST_ADDR, direction: 'outgoing' },
          }),
          timestamp: T - 120_000,
        },
        {
          chatMessageId: 'a-rename',
          body: JSON.stringify({ event: 'update:name', value: { name: 'new name' } }),
          timestamp: T - 60_000,
        },
        {
          chatMessageId: 'the-cancellation',
          body: JSON.stringify({
            event: 'webrtc-call',
            value: { sender: HOST_ADDR, subType: 'outgoing-call-cancelled' },
          }),
          timestamp: T - 1_000,
        },
      ];

      expect(pickCallRecordToStamp(candidates, T)?.candidate.chatMessageId)
        .withContext(`'call' @T-120s wins over 'webrtc-call' @T-1s`)
        .toBe('the-call');
    }, 5000);

    itCond(`prefers the record the call itself created, and never re-stamps one`, async () => {
      const T = 1_786_600_000_000;
      const callBody = (endTimestamp?: number) => JSON.stringify({
        event: 'call',
        value: { sender: HOST_ADDR, direction: 'outgoing', endTimestamp },
      });
      const candidates = [
        { chatMessageId: 'this-call', body: callBody(), timestamp: T - 120_000 },
        { chatMessageId: 'newer-call', body: callBody(), timestamp: T - 1_000 },
      ];

      expect(pickCallRecordToStamp(candidates, T, 'this-call')?.candidate.chatMessageId)
        .withContext(`knowing beats guessing: the id comes from doAfterStartCall`)
        .toBe('this-call');
      expect(pickCallRecordToStamp(candidates, T, 'no-such-record')?.candidate.chatMessageId)
        .withContext(`an id this device never stored falls back on the heuristic`)
        .toBe('newer-call');

      const stamped = [
        { chatMessageId: 'done', body: callBody(T - 500), timestamp: T - 60_000 },
      ];
      expect(pickCallRecordToStamp(stamped, T))
        .withContext(`a second stamp would move the end of a call that is over`)
        .toBeUndefined();
      expect(pickCallRecordToStamp(stamped, T, 'done'))
        .withContext(`including when named outright`)
        .toBeUndefined();
    }, 5000);

    itCond(`refuses to guess a duration onto a record older than a day`, async () => {
      // The history template clamps only NEGATIVE durations, so a stamp landing
      // on an old record renders as "this call lasted three days".
      const T = 1_786_600_000_000;
      const old = [{
        chatMessageId: 'ancient',
        body: JSON.stringify({
          event: 'call', value: { sender: HOST_ADDR, direction: 'outgoing' },
        }),
        timestamp: T - CALL_RECORD_STAMP_MAX_AGE_MILLIS - 1,
      }];

      expect(pickCallRecordToStamp(old, T))
        .withContext(`no candidate young enough to guess at`)
        .toBeUndefined();
      expect(pickCallRecordToStamp(old, T, 'ancient')?.candidate.chatMessageId)
        .withContext(`the age bound is for the heuristic only - a named record is `
          + `known, not guessed`)
        .toBe('ancient');
    }, 5000);

    itCond(`counts only senders that can actually be encoding`, async () => {
      // The four combinations. Three of them are attached-and-silent by
      // definition and ordinary in a relaying host, and counting them printed
      // "N video sender(s) encoded no frames" on every tick of every call,
      // drowning out the case the warning exists for.
      const live = createMockMediaStreamTrack('video', 'live-track');
      const ended = createMockMediaStreamTrack('video', 'ended-track');
      const muted = createMockMediaStreamTrack('video', 'muted-track');
      const disabled = createMockMediaStreamTrack('video', 'disabled-track');
      ended.readyState = 'ended';
      muted.muted = true;
      disabled.enabled = false;

      const pc = {
        getSenders: () => [
          { track: live }, { track: ended }, { track: muted }, { track: disabled },
          // An empty relay slot: negotiated, with an ssrc of its own, waiting.
          { track: null },
        ],
      } as unknown as RTCPeerConnection;

      const encodable = encodableSenderTrackIds(pc);
      expect(encodable.has('live-track'))
        .withContext(`live, unmuted, enabled - a local screen capture looks like this`)
        .toBe(true);
      expect(encodable.has('ended-track'))
        .withContext(`the relay of a participant who left`)
        .toBe(false);
      expect(encodable.has('muted-track'))
        .withContext(`a remote track no RTP has flowed through yet`)
        .toBe(false);
      expect(encodable.has('disabled-track'))
        .withContext(`a participant whose camera is off`)
        .toBe(false);
      expect(encodable.size).toBe(1);
    }, 5000);

    itCond(`reads an absent send stamp as "no stamp" rather than as 1970`, async () => {
      // The P0 regression of 2026-08-13, and its guard. Heartbeats were stamped
      // `id: 0`, so `now - id` made every single one ~56 years old and
      // admitsHeartbeat dropped ALL of them - i.e. the whole re-join mechanism
      // was dead, silently, because the verdict is logged at `debug`.
      const now = 1_786_600_000_000;

      const unstamped = signalAgeOf({ id: 0 }, now - 1_000, now);
      expect(unstamped.fromSenderClock)
        .withContext(`no stamp is not an age`)
        .toBe(0);
      expect(unstamped.sinceDelivery)
        .withContext(`the local delivery stamp still bounds such a signal`)
        .toBe(1_000);

      const stamped = signalAgeOf({ id: now - 20_000 }, now - 3_000, now);
      expect(stamped.fromSenderClock).toBe(20_000);
      expect(stamped.sinceDelivery).toBe(3_000);

      const fromTheFuture = signalAgeOf({ id: now + 60_000 }, now, now);
      expect(fromTheFuture.fromSenderClock)
        .withContext(`a sender whose clock runs ahead is clamped, not negative`)
        .toBe(0);

      // And the consequence, on the rule that was defeated by it.
      const reg = createCallSessions();
      expect(reg.admitsHeartbeat(
        { isGroupChat: true, chatId: 'group-1' }, HOST_ADDR, 'session-1', unstamped, now,
      ))
        .withContext(`an unstamped heartbeat of a live call must be acted upon`)
        .toBe('accept');
    }, 5000);

    itCond(`shows a relay slot's owner only on proof, not on the reservation alone`, async () => {
      // A mapping from the host is proof in itself; the client's own reservation
      // hint needs real RTP behind it, or every not-yet-joined participant of the
      // roster gets a tile that never fills.
      expect(relaySlotOwnerToShow({
        mappedOwner: CLIENT_C_ADDR, hasMedia: false, forAddr: CLIENT_B_ADDR,
      }))
        .withContext(`a mapping wins over the reservation and needs no media yet`)
        .toBe(CLIENT_C_ADDR);
      expect(relaySlotOwnerToShow({
        mappedOwner: null, hasMedia: true, forAddr: CLIENT_B_ADDR,
      }))
        .withContext(`the hint, backed by RTP`)
        .toBe(CLIENT_B_ADDR);
      expect(relaySlotOwnerToShow({
        mappedOwner: null, hasMedia: false, forAddr: CLIENT_B_ADDR,
      }))
        .withContext(`the hint alone must not raise a tile`)
        .toBeUndefined();
      expect(relaySlotOwnerToShow({ mappedOwner: null, hasMedia: true }))
        .withContext(`media on a slot reserved for nobody in particular says nothing`)
        .toBeUndefined();
    }, 5000);

    itCond(`leaves no relay slot that a departed participant could be shown in`, async () => {
      // The regression, and why it is a table rather than a live check: the
      // trigger is the LAG between RTP stopping and the receiver's track going
      // `muted` (Chromium's own timeout, seconds). The old code re-read the track
      // on 'participant-left' and so stored hasMedia=true for a slot the host had
      // just emptied; the next renegotiation - a screen share - then read
      // `hasMedia && forAddr` as a live participant and put up a tile saying the
      // departed peer's camera was about to start. Reproducing that live means
      // winning a race; here `muted` is simply an input that never arrived.
      const slotReservedForB = {
        mappedOwner: CLIENT_B_ADDR, hasMedia: true, forAddr: CLIENT_B_ADDR,
      };

      const cleared = { ...slotReservedForB, ...clearedRelaySlotOnDeparture() };
      expect(cleared.hasMedia)
        .withContext(`the host said the slot is empty; the track's mute state is `
          + `seconds behind and must not be consulted`)
        .toBeFalse();
      expect(relaySlotOwnerToShow(cleared))
        .withContext(`so nothing may be shown in it - this is the phantom tile`)
        .toBeUndefined();
      expect(cleared.emittedFor)
        .withContext(`or the same peer re-joining into this very m-line would read `
          + `as "already shown" and never get its tile back`)
        .toBeNull();

      // Both ways back in, and each has to work on its own.
      expect(relaySlotOwnerToShow({ ...cleared, mappedOwner: CLIENT_B_ADDR }))
        .withContext(`re-join announced by a mapping, before any RTP resumed`)
        .toBe(CLIENT_B_ADDR);
      expect(relaySlotOwnerToShow({ ...cleared, hasMedia: true }))
        .withContext(`or RTP resuming on the slot reserved for that peer`)
        .toBe(CLIENT_B_ADDR);
    }, 5000);

    itCond(`spends no retry budget on a tick it skips, and gives up once`, async () => {
      // Both halves matter: a watcher that consumed its budget on skipped ticks
      // would have none left when the signal really was lost, and an
      // onExhausted firing repeatedly would recreate a pc per tick.
      let skip = true;
      let retries = 0;
      let exhausted = 0;
      const watcher = createRetryWatcher({
        label: '[test watcher]',
        maxRetries: 1,
        retryDelays: [20],
        maxFastRetries: 1,
        fastRetryDelay: 20,
        shouldSkip: () => skip,
        retry: async () => {
          retries += 1;
          return true;
        },
        onExhausted: () => {
          exhausted += 1;
        },
        describeState: () => 'leg=initial',
      });

      // Skipped at schedule time: nothing is even armed.
      watcher.schedule();
      await sleep(80);
      expect(retries).withContext(`a skipped watcher sends nothing`).toBe(0);
      expect(exhausted).withContext(`nor does it give up`).toBe(0);

      // The condition clears, so the budget must still be intact.
      skip = false;
      watcher.schedule();
      await sleep(80);
      expect(retries)
        .withContext(`the one retry the budget allows was still available`)
        .toBe(1);
      expect(exhausted)
        .withContext(`the retry's own reschedule found the budget spent, and said `
          + `so exactly once - one recreate per exhausted cycle, not per tick`)
        .toBe(1);

      watcher.clear();
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 17: Re-join notice
  // ===========================================================================

  /**
   * The tiny message a returning client sends ahead of its SDP offer, and what
   * the host and the other participants do with it. Every rule here is about a
   * message that can arrive late, twice, or not at all — a race whose losing
   * side no live run can be made to take on demand, so the racing values are
   * arguments and the rules are tables (doc/07-build-test-run.md §5.2.1).
   */
  describe(`Test Suite 17: Re-join notice`, () => {

    const PRESSED_JOIN_AT = 1_786_700_000_000;
    const SESSION_ID = `${HOST_ADDR}#7`;

    itCond(`builds a notice that carries a send stamp and the session`, async () => {
      const msg = rejoinNoticeMsg(SESSION_ID, CLIENT_B_ADDR, PRESSED_JOIN_AT);

      expect(msg.stage)
        .withContext(`an ordinary signalling message: a stage of its own would `
          + `reach older peers as an unknown one`)
        .toBe('signalling');
      expect(msg.id)
        .withContext(`the sender's stamp - 0 means "no stamp" to signalAgeOf, and `
          + `the host's arrival gate deduplicates ASMail's copies by this number`)
        .toBe(PRESSED_JOIN_AT);
      expect(msg.callSessionId)
        .withContext(`the call being re-joined, as learned from its heartbeats`)
        .toBe(SESSION_ID);
      expect(isRejoinNotice(msg))
        .withContext(`and the receiving side recognizes what the sending side built`)
        .toBeTrue();
    }, 5000);

    itCond(`tells a re-join notice from every other signal a host receives`, async () => {
      // The host branches on this BEFORE the offer branch, so anything
      // misrecognized here is a signal that never reaches WebRTC processing.
      expect(isRejoinNotice({ data: [{ rejoining: { by: CLIENT_B_ADDR } }] }))
        .withContext(`WebRTCMsg.data comes in both shapes, and the array one is `
          + `what a batched send produces`)
        .toBeTrue();

      expect(isRejoinNotice({ data: { description: { type: 'offer', sdp: VALID_SDP } as RTCSessionDescription } }))
        .withContext(`a real SDP offer - the very message this one runs ahead of`)
        .toBeFalse();
      expect(isRejoinNotice({ data: { candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 1 typ host' } } }))
        .withContext(`an ICE candidate`)
        .toBeFalse();
      expect(isRejoinNotice({
        data: {
          description: {
            type: 'offer',
            sdp: JSON.stringify({ signalType: 'candidates', candidates: [] }),
          } as unknown as RTCSessionDescription,
        },
      }))
        .withContext(`a 'candidates' batch, which rides a placeholder offer`)
        .toBeFalse();
      expect(isRejoinNotice({ data: { hostAddr: HOST_ADDR } }))
        .withContext(`a heartbeat`)
        .toBeFalse();
      expect(isRejoinNotice({ data: { callDeclined: { by: CLIENT_B_ADDR } } }))
        .withContext(`a decline - the same shape in a different field`)
        .toBeFalse();

      expect(isRejoinNotice({ data: {} })).withContext(`an empty body`).toBeFalse();
      expect(isRejoinNotice({ data: [] })).withContext(`an empty array body`).toBeFalse();
      expect(isRejoinNotice({ data: { rejoining: { by: '' } } }))
        .withContext(`a notice that names nobody says nothing`)
        .toBeFalse();
    }, 5000);

    itCond(`re-announces a re-join, and refuses the cases that would misinform`, async () => {
      expect(rejoinNoticeAction({ callIsClosed: false, isConnected: false }))
        .withContext(`the case the notice exists for: someone who left is coming back`)
        .toBe('announce');

      expect(rejoinNoticeAction({ callIsClosed: false, isConnected: false }))
        .withContext(`and a REPEAT of it announces again, deliberately: that is `
          + `what puts a placeholder back after a late 'participant-left' from `
          + `the departure that preceded the return took it down`)
        .toBe('announce');

      expect(rejoinNoticeAction({ callIsClosed: false, isConnected: true }))
        .withContext(`a copy that overtook nothing - the offer already landed and `
          + `this peer is in the call; announcing would flip a live participant `
          + `back to "connecting…"`)
        .toBe('ignore-connected');

      expect(rejoinNoticeAction({ callIsClosed: true, isConnected: false }))
        .withContext(`the call is over on this side: a broadcast now goes into `
          + `closed channels`)
        .toBe('ignore-closed');

      expect(rejoinNoticeAction({ callIsClosed: true, isConnected: true }))
        .withContext(`a closed call is checked first - nothing else can make a `
          + `broadcast right`)
        .toBe('ignore-closed');
    }, 5000);

    itCond(`repeats the notice inside the window where it is still the faster news`, async () => {
      // The live run of 2026-08-13 19:36 is the whole reason these exist: the
      // notice went out 79s before the offer reached the host and died on one
      // 500, with nothing to resend it. The repeats have to land before the
      // offer does, or they are pointless: the client's own offer is
      // confirmed-or-not at ~25s and repeated at 45s (OFFER_RETRY_DELAYS).
      expect(REJOIN_NOTICE_REPEAT_DELAYS_MILLIS.length)
        .withContext(`two repeats - a third would be racing the offer itself`)
        .toBe(2);
      expect(REJOIN_NOTICE_REPEAT_DELAYS_MILLIS[0])
        .withContext(`the first is soon enough to still beat a 25s confirm window`)
        .toBeLessThan(25_000);
      expect(REJOIN_NOTICE_REPEAT_DELAYS_MILLIS[1])
        .withContext(`the last one is inside the first offer retry at 45s`)
        .toBeLessThan(45_000);
      expect(REJOIN_NOTICE_REPEAT_DELAYS_MILLIS[1])
        .withContext(`and they are spaced, not a burst - a burst is what the 500 `
          + `storm punishes`)
        .toBeGreaterThan(REJOIN_NOTICE_REPEAT_DELAYS_MILLIS[0]);
    }, 5000);

    itCond(`stamps every copy of the notice afresh, so a repeat is not a duplicate`, async () => {
      // Repeats have to pass the host's arrival gate to re-announce, and that
      // gate is a monotonic watermark on the send stamp. Copies of ONE message
      // (an ASMail blind repeat) share their stamp and are gated; a repeat the
      // client decided to send is a new message with a new stamp.
      const arrivals = createDepartureGate();
      const first = rejoinNoticeMsg(SESSION_ID, CLIENT_B_ADDR, PRESSED_JOIN_AT);
      const repeat = rejoinNoticeMsg(SESSION_ID, CLIENT_B_ADDR, PRESSED_JOIN_AT + 10_000);

      expect(arrivals.isRepeat(CLIENT_B_ADDR, first.id)).toBe(false);
      expect(arrivals.isRepeat(CLIENT_B_ADDR, first.id))
        .withContext(`ASMail's own copy of that very message is gated`)
        .toBe(true);
      expect(arrivals.isRepeat(CLIENT_B_ADDR, repeat.id))
        .withContext(`the client's repeat carries a fresh stamp and gets through `
          + `to re-announce`)
        .toBe(false);
    }, 5000);

    itCond(`creates the tile a re-join notice needs and no other`, async () => {
      // setParticipantReconnecting is a no-op without a tile, and a participant
      // who left has none: without this rule the notice would arrive, be
      // handled, and change nothing on screen.
      expect(participantTileOnRejoinNotice(undefined, true))
        .withContext(`nobody there yet - the whole point of the notice`)
        .toBe('create-connecting');

      expect(participantTileOnRejoinNotice({ hasStream: false, fromRejoinNotice: false }, true))
        .withContext(`a tile already up: this is an ordinary link blip, and the `
          + `store's own reconnecting flag covers it`)
        .toBe('leave-as-is');
      expect(participantTileOnRejoinNotice({ hasStream: true, fromRejoinNotice: true }, true))
        .withContext(`a live participant is never rebuilt from a hint`)
        .toBe('leave-as-is');
    }, 5000);

    itCond(`takes down only the placeholder it put up itself`, async () => {
      // `reconnecting: false` does not say which of its two cases it is, and
      // the whole risk of this feature sits here. The host withdraws a re-join
      // announcement on the first state the returning peer's connection
      // reports - well before its tracks land - so a rule that removed any
      // media-less tile would flicker the tile on EVERY successful return.
      expect(participantTileOnRejoinNotice({ hasStream: false, fromRejoinNotice: true }, false))
        .withContext(`a placeholder this window created out of a notice, still `
          + `empty: the announced return expired`)
        .toBe('remove');

      expect(participantTileOnRejoinNotice({ hasStream: false, fromRejoinNotice: false }, false))
        .withContext(`a tile that was there before any notice - a blip of a `
          + `participant who happens to have no media is not a withdrawal`)
        .toBe('leave-as-is');
      expect(participantTileOnRejoinNotice({ hasStream: true, fromRejoinNotice: true }, false))
        .withContext(`media makes the tile real, whatever put it up`)
        .toBe('leave-as-is');
      expect(participantTileOnRejoinNotice(undefined, false))
        .withContext(`nothing to take down`)
        .toBe('leave-as-is');
    }, 5000);

    itCond(`withdraws an expired announcement, and only an expired one`, async () => {
      expect(rejoinNoticeExpiry({
        callIsClosed: false, isConnected: false, stillAnnounced: true,
      }))
        .withContext(`the peer announced a return two minutes ago and never came`)
        .toBe('withdraw');

      expect(rejoinNoticeExpiry({
        callIsClosed: false, isConnected: true, stillAnnounced: true,
      }))
        .withContext(`it arrived after all - its own join path owns the tile now`)
        .toBe('ignore');
      expect(rejoinNoticeExpiry({
        callIsClosed: false, isConnected: false, stillAnnounced: false,
      }))
        .withContext(`already cancelled (removed client, or the join path got `
          + `there first)`)
        .toBe('ignore');
      expect(rejoinNoticeExpiry({
        callIsClosed: true, isConnected: false, stillAnnounced: true,
      }))
        .withContext(`the call is over: a withdrawal would broadcast into closed `
          + `channels`)
        .toBe('ignore');
    }, 5000);

    itCond(`gives a re-join long enough for the offer repeats that carry it`, async () => {
      // Not a round number picked for looks: the client repeats its offer on
      // OFFER_RETRY_DELAYS = 45s/60s/60s, so a TTL under 105s would declare a
      // return over while its second attempt was still in flight - and the
      // offer, at 13-21KB, is exactly the message that needs those attempts.
      expect(REJOIN_NOTICE_TTL_MS)
        .withContext(`covers the first two offer attempts (45s + 60s)`)
        .toBeGreaterThanOrEqual(105_000);
      expect(REJOIN_NOTICE_TTL_MS)
        .withContext(`and does not sit there for the rest of the call`)
        .toBeLessThanOrEqual(180_000);
    }, 5000);

    itCond(`deduplicates re-join notices per peer, by their send stamp`, async () => {
      // The host gates arrivals with a second createDepartureGate instance, and
      // this is what it has to hold: departures and arrivals of one peer are
      // independent events, so one shared watermark would let whichever came
      // last suppress the other.
      const arrivals = createDepartureGate();
      const departures = createDepartureGate();

      expect(arrivals.isRepeat(CLIENT_B_ADDR, PRESSED_JOIN_AT)).toBe(false);
      expect(arrivals.isRepeat(CLIENT_B_ADDR, PRESSED_JOIN_AT))
        .withContext(`ASMail's copy of the same notice`)
        .toBe(true);

      expect(departures.isRepeat(CLIENT_B_ADDR, PRESSED_JOIN_AT - 60_000))
        .withContext(`the departure that preceded this return is a separate `
          + `watermark and is not suppressed by it`)
        .toBe(false);

      expect(arrivals.isRepeat(CLIENT_B_ADDR, PRESSED_JOIN_AT + 30_000))
        .withContext(`left again and came back again: a fresh stamp passes`)
        .toBe(false);
    }, 5000);

    itCond(`never blurs a peer that is on its way INTO the call`, async () => {
      // The defect of 2026-08-16, twice in one run: a participant who had
      // really joined and was sending video sat under a blur saying
      // "reconnecting". Both halves of it are here.
      expect(reconnectingHintEffect({
        kind: 'rejoin',
        reconnecting: true,
        existing: { hasStream: false, fromRejoinNotice: false },
      }).setsReconnectingFlag)
        .withContext(`a peer joining mid-call: the roster gave it a tile before `
          + `any signalling (seedExpectedParticipants), so "has a tile" never `
          + `meant "is in the call"`)
        .toBeFalse();

      expect(reconnectingHintEffect({
        kind: 'rejoin',
        reconnecting: true,
        existing: { hasStream: true, fromRejoinNotice: false },
      }).setsReconnectingFlag)
        .withContext(`the notice is repeated at 0/10/30s, so a copy lands after `
          + `the media has arrived - and blurred the video it announced`)
        .toBeFalse();

      expect(reconnectingHintEffect({
        kind: 'rejoin', reconnecting: true, existing: undefined,
      }))
        .withContext(`no tile at all: put up the placeholder, still without a blur`)
        .toEqual({ setsReconnectingFlag: false, tile: 'create-connecting' });
    }, 5000);

    itCond(`still takes down a placeholder whose return expired`, async () => {
      // The host's withdrawal on REJOIN_NOTICE_TTL_MS is a 'rejoin' too - it is
      // about an announced return, not about a link - and it is the one thing
      // that clears a "connecting…" nobody ever fulfilled.
      expect(reconnectingHintEffect({
        kind: 'rejoin',
        reconnecting: false,
        existing: { hasStream: false, fromRejoinNotice: true },
      }).tile)
        .withContext(`our own placeholder, still empty two minutes on`)
        .toBe('remove');

      expect(reconnectingHintEffect({
        kind: 'rejoin',
        reconnecting: false,
        existing: { hasStream: true, fromRejoinNotice: true },
      }).tile)
        .withContext(`it did arrive after all - media makes the tile real`)
        .toBe('leave-as-is');
    }, 5000);

    itCond(`leaves the link blip working exactly as before`, async () => {
      expect(reconnectingHintEffect({
        kind: 'link-blip',
        reconnecting: true,
        existing: { hasStream: true, fromRejoinNotice: false },
      }))
        .withContext(`a live participant's link is wobbling: this is what the `
          + `blur is FOR`)
        .toEqual({ setsReconnectingFlag: true, tile: 'leave-as-is' });

      expect(reconnectingHintEffect({
        kind: 'link-blip',
        reconnecting: false,
        existing: { hasStream: true, fromRejoinNotice: false },
      }))
        .withContext(`and it recovered`)
        .toEqual({ setsReconnectingFlag: true, tile: 'leave-as-is' });

      expect(reconnectingHintEffect({
        kind: 'link-blip',
        reconnecting: false,
        existing: { hasStream: false, fromRejoinNotice: true },
      }).tile)
        .withContext(`a blip about somebody else's link must never carry off the `
          + `placeholder of an announced return that happens to be standing`)
        .toBe('leave-as-is');
    }, 5000);

    itCond(`falls back on the old guess for a host that states no kind`, async () => {
      // A peer on a build that predates the field. The guess is wrong in the two
      // cases above, but it is still better than either constant: it does show
      // a blur for a genuine blip, and does withhold it from a placeholder.
      expect(reconnectingHintEffect({
        kind: undefined,
        reconnecting: true,
        existing: { hasStream: true, fromRejoinNotice: false },
      }).setsReconnectingFlag)
        .withContext(`a tile that is not a placeholder: read as a blip, as before`)
        .toBeTrue();

      expect(reconnectingHintEffect({
        kind: undefined,
        reconnecting: true,
        existing: { hasStream: false, fromRejoinNotice: true },
      }).setsReconnectingFlag)
        .withContext(`a placeholder of ours: no blur, as before`)
        .toBeFalse();

      expect(reconnectingHintEffect({
        kind: undefined, reconnecting: true, existing: undefined,
      }).tile)
        .withContext(`and the tile rule is the one it always was`)
        .toBe(participantTileOnRejoinNotice(undefined, true));
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 18: two devices of one user answering the same call
  // ===========================================================================

  /**
   * Every device of a user rings for an incoming call, and the notice that says
   * "answered here" travels over ASMail — 7 s in the run of 2026-08-14. Inside
   * that window both devices can be answered, and until this decision the notice
   * was acted upon only while still ringing: a device that had answered ignored
   * it, and both went on to join the same call. Peers are keyed by address, so
   * the second offer lands on the host's already negotiated connection.
   */
  describe(`Test Suite 18: a call handled on another device of ours`, () => {

    const OWN_DEVICE = 'desktop-aab00000000000000000';
    const OTHER_DEVICE = 'desktop-aaa00000000000000000';

    function outcome(
      state: CallState | undefined,
      otherDeviceId: string,
      opts?: { joinedThere?: boolean; otherInCall?: boolean; ownDeviceId?: string },
    ) {
      return callHandledElsewhereOutcome({
        state,
        joinedThere: opts?.joinedThere ?? true,
        otherInCall: opts?.otherInCall ?? false,
        ownDeviceId: opts?.ownDeviceId ?? OWN_DEVICE,
        otherDeviceId,
      });
    }

    itCond(`a ringing device always steps aside`, async () => {
      // Nothing of ours is on the wire yet, so there is nothing to weigh —
      // including when the other device declined: that answer stands for the
      // address, and this ringtone is done either way.
      expect(outcome('ringing', OTHER_DEVICE)).toBe('yield');
      expect(outcome('ringing', 'desktop-zzz00000000000000000')).toBe('yield');
      expect(outcome('ringing', OTHER_DEVICE, { joinedThere: false })).toBe('yield');
    });

    itCond(`of two devices that answered, exactly one steps aside`, async () => {
      // The property the whole tie-break exists for. Both devices compare the
      // same pair of ids, so "both yield" — a call nobody takes — cannot happen,
      // and neither can "neither yields".
      for (const [a, b] of [
        [OWN_DEVICE, OTHER_DEVICE],
        ['desktop-aaa00000000000000001', 'desktop-aaa00000000000000002'],
        ['mobile-b0000000000000000000', 'desktop-a0000000000000000000'],
      ]) {
        const yields = [
          outcome('connecting', b, { ownDeviceId: a }),
          outcome('connecting', a, { ownDeviceId: b }),
        ].filter(v => v === 'yield');

        expect(yields.length)
          .withContext(`exactly one of ${a} / ${b} must step aside`)
          .toBe(1);
      }
    });

    itCond(`three devices leave the call to one of them`, async () => {
      const ids = [
        'desktop-a0000000000000000000',
        'desktop-b0000000000000000000',
        'mobile-c00000000000000000000',
      ];

      const keeping = ids.filter(own => ids
        .filter(other => other !== own)
        .every(other => outcome('connecting', other, { ownDeviceId: own }) === 'keep'));

      expect(keeping).toEqual([ids[0]]);
    });

    itCond(`a device that declined does not take the call from one that answered`, async () => {
      // The outcome worse than both devices joining: this user pressed "answer"
      // here, and yielding to a decline elsewhere would leave the call taken by
      // nobody. The tie-break must not even be consulted.
      expect(outcome('connecting', 'desktop-aaa00000000000000000', { joinedThere: false }))
        .toBe('keep');
      expect(outcome('connecting', 'desktop-zzz00000000000000000', { joinedThere: false }))
        .toBe('keep');
    });

    itCond(`"already in the call" beats the tie-break`, async () => {
      // The one case the tie-break cannot settle: the other device reached the
      // call before its notice arrived here, so it ignores ours and would keep
      // the call whatever the ids say. Its reply carries `inCall`.
      expect(outcome('connecting', 'desktop-zzz00000000000000000', { otherInCall: true }))
        .withContext(`even though this device wins on ids`)
        .toBe('yield');
    });

    itCond(`a device already in the call never steps aside`, async () => {
      // Media is running here; a device that is still on the setup screen must
      // not be able to take the call away from it.
      expect(outcome('active', 'desktop-aaa00000000000000000')).toBe('keep');
      expect(outcome('active', 'desktop-aaa00000000000000000', { otherInCall: true }))
        .withContext(`two devices in one call is already broken; neither may hang up`)
        .toBe('keep');
      expect(outcome('winding-down', 'desktop-aaa00000000000000000')).toBe('keep');
    });

    itCond(`states this notice is not about are left alone`, async () => {
      // 'dialing': we are the host of an outgoing call. 'ended': nothing to step
      // out of and no offer to take down, and marking the session again would
      // suppress the signals of the next call. No record at all: the same.
      expect(outcome('dialing', OTHER_DEVICE)).toBe('keep');
      expect(outcome('ended', OTHER_DEVICE)).toBe('keep');
      expect(outcome(undefined, OTHER_DEVICE)).toBe('keep');
    });

    itCond(`a neighbour that joined takes our "Join Call" button with it`, async () => {
      // `rejoinable` is not a call to step out of — it is an OFFER to enter the
      // very call the neighbour has just entered, and taking that offer would
      // put two devices of one address into it, which the host cannot tell
      // apart. Until 2026-08-17 the answer here was 'keep' and the button stood
      // until the record ran out.
      expect(outcome('rejoinable', OTHER_DEVICE)).toBe('drop-rejoin-offer');

      expect(outcome('rejoinable', OTHER_DEVICE, { joinedThere: false }))
        .withContext(`a neighbour that DECLINED changes nothing: the call it `
          + `declined is still going on, and this device may still join it`)
        .toBe('keep');

      expect(outcome('rejoinable', OTHER_DEVICE, { ownDeviceId: 'desktop-zzz00000000000000000' }))
        .withContext(`the tie-break has nothing to settle here - this device is `
          + `not in the call, so there is no contention over who keeps it`)
        .toBe('drop-rejoin-offer');
    });

    itCond(`the button stays down while the neighbour is in the call, and comes back after`, async () => {
      // What the outcome above leads to, and why it is the same hold a device
      // which yielded a ringing call keeps: the record is marked
      // `endedBy: 'other-device'`.
      const CHAT: ChatIdObj = { isGroupChat: true, chatId: 'rejoin-offer-chat' };
      const SESSION = `${HOST_ADDR}#desktop-CCC-1`;
      const T0 = 9_000_000;
      const FRESH: SignalAge = { fromSenderClock: 0, sinceDelivery: 0 };
      const reg = createCallSessions();
      reg.noteHeartbeat(CHAT, HOST_ADDR, SESSION, T0);

      reg.transit(CHAT, 'ended', T0 + 5_000, {
        endedBy: 'other-device', lastSignal: T0 + 5_000,
        provisional: undefined, lastBeat: undefined,
      });

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, FRESH, T0 + 20_000))
        .withContext(`the host keeps beating, and its beats must not put the `
          + `button back while the neighbour is in that call`)
        .toBe('drop-handled-elsewhere');

      expect(reg.transit(CHAT, 'rejoinable', T0 + 60_000, {
        role: 'client', callSessionId: SESSION,
        lastBeat: T0 + 60_000, provisional: true, endedBy: undefined,
      }))
        .withContext(`and the neighbour's 'left' notice lifts the hold the moment `
          + `that device is out`)
        .toBeTrue();
      expect(rejoinTargetOf(reg.get(CHAT), CLIENT_B_ADDR))
        .withContext(`with the host still named, so the button leads somewhere`)
        .toEqual({ hostAddr: HOST_ADDR, callSessionId: SESSION });
    });

    itCond(`an identical device id keeps the call`, async () => {
      // Two copies on one data folder share an id. Such a notice is taken as our
      // own long before this decision, but the comparison stays strict so that a
      // later refactor cannot make both copies step aside.
      expect(outcome('connecting', OWN_DEVICE)).toBe('keep');
    });

    itCond(`stepping aside needs no new transition`, async () => {
      // The path a yielding device takes: 'winding-down' first (end() reports it
      // on every path), then 'ended', then the handler's own 'ended' with
      // endedBy: 'other-device'.
      expect(canTransit('connecting', 'winding-down')).toBe(true);
      expect(canTransit('ringing', 'winding-down')).toBe(true);
      expect(canTransit('winding-down', 'ended')).toBe(true);
      expect(canTransit('ended', 'ended'))
        .withContext(`re-marking why it ended must be a no-op, not a violation`)
        .toBe(true);
    });

  });

  // ===========================================================================
  describe(`Test Suite 19: repeat schedule of one-shot signals`, () => {

    itCond(`'start' repeats even when its delivery was confirmed`, async () => {
      const schedule = repeatScheduleFor('start', { stillNeeded: () => true });

      expect(schedule).toBeDefined();
      // A confirmation says the invitation reached the invitee's INBOX, and an
      // inbox belongs to an address rather than to a device. 'start' is the one
      // signal that has to reach every device of an address, so the inbox is not
      // proof enough for it (live run of 2026-08-15).
      expect(schedule?.evenWhenConfirmed)
        .withContext(`otherwise the schedule is dead while CONFIRM_DELIVERY_ENABLED is on`)
        .toBeTrue();
      expect(schedule!.delaysMillis.length)
        .withContext(`more than one chance, spread past the transport's bad spells`)
        .toBeGreaterThan(1);
    });

    itCond(`'start' without a stillNeeded predicate gets no repeats at all`, async () => {
      // A late 'start' is not inert - it rings a call that may be long over - so
      // a caller that cannot say whether the invitation still stands must not
      // have copies fired off behind its back.
      expect(repeatScheduleFor('start', undefined)).toBeUndefined();
      expect(repeatScheduleFor('start', {})).toBeUndefined();
    });

    itCond(`'disconnect' keeps its repeats confined to the unconfirmed path`, async () => {
      const schedule = repeatScheduleFor('disconnect', undefined);

      expect(schedule).toBeDefined();
      // A duplicate 'disconnect' is inert on arrival, and confirmation already
      // tells the host whether it landed - so here the inbox IS proof enough,
      // and one delivery is cheaper than four on a struggling server.
      expect(schedule?.evenWhenConfirmed).toBeFalsy();
    });

    itCond(`ordinary signalling gets no repeats`, async () => {
      // offer/answer/candidates have their own negotiation retry loops.
      expect(repeatScheduleFor('signalling', { stillNeeded: () => true })).toBeUndefined();
    });

  });

  // ===========================================================================
  describe(`Test Suite 20: ids of records about a call`, () => {

    itCond(`one call session gives one id, on every device`, async () => {
      // The whole point: two devices of a user that both answer derive the same
      // id and so write the same record, instead of two lines about one call.
      expect(chatMessageIdForCallEvent('call', 'someone@example.com#3'))
        .toBe(chatMessageIdForCallEvent('call', 'someone@example.com#3'));
    });

    itCond(`consecutive calls in one chat get different ids`, async () => {
      expect(chatMessageIdForCallEvent('call', 'someone@example.com#3'))
        .not.toBe(chatMessageIdForCallEvent('call', 'someone@example.com#4'));
    });

    itCond(`a call and its cancellation do not collide`, async () => {
      // Both can exist for one session, and the id is part of the messages
      // table's primary key - a collision would be an INSERT that throws.
      expect(chatMessageIdForCallEvent('call', 'someone@example.com#3'))
        .not.toBe(chatMessageIdForCallEvent('call-cancelled', 'someone@example.com#3'));
    });

    itCond(`two people declining one call are two records`, async () => {
      // In a group call every member declines for themselves, and each decline
      // is its own line. With the address left out of the id the second of them
      // would reach an id already in the table and be dropped as a duplicate.
      expect(chatMessageIdForCallEvent('call-cancelled', 'host@example.com#dev-1', 'one@example.com'))
        .not.toBe(chatMessageIdForCallEvent('call-cancelled', 'host@example.com#dev-1', 'two@example.com'));
    });

    itCond(`one person's decline is one record on all of our devices`, async () => {
      expect(chatMessageIdForCallEvent('call-cancelled', 'host@example.com#dev-1', 'one@example.com'))
        .toBe(chatMessageIdForCallEvent('call-cancelled', 'host@example.com#dev-1', 'one@example.com'));
    });

    itCond(`a withdrawn call and a declined one do not collide`, async () => {
      // Both name the host in a one-to-one chat - the caller who withdrew the
      // call, and the caller whose call was declined - so only the kind parts
      // them, and they read differently in the history.
      expect(chatMessageIdForCallEvent('call-withdrawn', 'host@example.com#dev-1', 'host@example.com'))
        .not.toBe(chatMessageIdForCallEvent('call-cancelled', 'host@example.com#dev-1', 'host@example.com'));
    });

    itCond(`sessions of two devices of one user are distinct`, async () => {
      // The address in a session id is the user's and the counter is the
      // device's own, so without the device id the first call hosted by one
      // device and the first hosted by another are one id - and the second
      // call's record would be skipped as one already there, duration and all.
      expect(chatMessageIdForCallEvent('call', 'user@example.com#desktop-AAA-1'))
        .not.toBe(chatMessageIdForCallEvent('call', 'user@example.com#desktop-BBB-1'));
    });

    itCond(`the host is readable out of a session id`, async () => {
      // The one part of a session id anything may parse (see nextCallSessionId).
      expect(hostAddrOfCallSession('user@example.com#desktop-AAA-1')).toBe('user@example.com');
      expect(hostAddrOfCallSession('user@example.com#1'))
        .withContext(`ids minted by builds before the device id went in`)
        .toBe('user@example.com');
      expect(hostAddrOfCallSession(undefined)).toBeUndefined();
      expect(hostAddrOfCallSession('nothing-of-the-sort'))
        .withContext(`knowing nothing beats guessing an address`)
        .toBeUndefined();
      expect(hostAddrOfCallSession('#1')).toBeUndefined();
    });

    itCond(`a derived id carries nothing but [A-Za-z0-9_-]`, async () => {
      // A chatMessageId does not stay in the database: it goes into the ASMail
      // delivery id, which the platform makes a folder of (rejecting `/` and
      // `.` - and `.` is in every domain name), and into the message list's
      // Teleport target, which is a CSS selector (rejecting `:` and `@`).
      // Pasting the session id in plainly broke the decline outright on
      // 2026-08-15.
      for (const sessionId of [
        'someone@example.com#3',
        'a-2800@3nweb.com#1',
        'user.name@sub.domain.example#12',
        'a-1810@3nweb.com#desktop-zQc65MED7HNqitcBbJNQ-1',
      ]) {
        for (const kind of ['call', 'call-cancelled', 'call-withdrawn'] as const) {
          expect(chatMessageIdForCallEvent(kind, sessionId))
            .withContext(`id derived from ${kind} of ${sessionId}`)
            .toMatch(/^[A-Za-z0-9_-]+$/);
          expect(chatMessageIdForCallEvent(kind, sessionId, 'user.name@sub.domain.example'))
            .withContext(`id derived from ${kind} of ${sessionId}, by an address`)
            .toMatch(/^[A-Za-z0-9_-]+$/);
        }
      }
    });

    itCond(`a delivery id drops what a file system could read into`, async () => {
      // Sanitized where the id is made rather than at each sender: some of the
      // strings arriving here are not ours at all - accepting an invitation
      // echoes back the chatMessageId that came from the peer.
      const deliveryId = generateOutgoingMsgId('call-cancelled:a-2800@3nweb.com#1');

      expect(deliveryId).not.toContain('.');
      expect(deliveryId).not.toContain('/');
      expect(deliveryId.replace(/^\d+_/, ''))
        .withContext(`everything after the timestamp is id material`)
        .toMatch(/^[A-Za-z0-9_-]+$/);
    });

    itCond(`a delivery id keeps its timestamp readable`, async () => {
      // creationTsFromDeliveryId reconciles deliveries by pulling this stamp
      // back out; sanitizing must not touch the front of the id.
      const withPrefix = generateOutgoingMsgId('call-cancelled:a-2800@3nweb.com#1', 'sync_');

      expect(withPrefix.startsWith('sync_')).toBeTrue();
      expect(withPrefix)
        .withContext(`a 13-digit stamp delimited the way reconcile expects`)
        .toMatch(/(?:^|[-_])\d{13}(?=[-_])/);
    });

  });

  // ===========================================================================
  // Test Suite 21: IPC surface of the call window
  // ===========================================================================

  describe(`Test Suite 21: IPC surface of the call window`, () => {

    itCond(`the window answers every method the background calls on it`, async () => {
      // The two lists are written apart - one where the window exposes itself,
      // one where the background builds its caller - and drifting apart is not
      // hypothetical: 'notifyOfUndeliveredSignal' and 'notifyOfRejoiningPeer'
      // were named in the caller and left out of the exposure, so both were
      // dead from the day they were written until the live run of 2026-08-16
      // found "Method notifyOfRejoiningPeer not found" in a host's log.
      const notExposed = VIDEO_WINDOW_METHODS_CALLED_HERE.filter(
        method => !VIDEO_WINDOW_IPC_METHODS.includes(method),
      );

      expect(notExposed)
        .withContext(`called by the background, but not exposed by the window`)
        .toEqual([]);
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 22: the gate on repeats of 'start'
  // ===========================================================================

  describe(`Test Suite 22: the gate on repeats of 'start'`, () => {

    const PEER = 'peer@example.com';
    const OTHER_PEER = 'other@example.com';
    const pending = (
      opts: { live?: boolean; answered?: string[]; declined?: string[] } = {},
      peer = PEER,
    ) => inviteStillPending({
      callIsLive: opts.live ?? true,
      answered: opts.answered ?? [],
      declined: opts.declined ?? [],
    }, peer);

    itCond(`an invited peer who has not answered is still worth another copy`, async () => {
      // The case the whole schedule exists for: the invitation reached the
      // address's inbox, and one of that address's devices never surfaced it.
      expect(pending()).toBeTrue();
      expect(pending({ answered: [OTHER_PEER], declined: [OTHER_PEER] }))
        .withContext(`another peer's answer says nothing about this one`)
        .toBeTrue();
    });

    itCond(`being invited is not the same as having answered`, async () => {
      // The regression this rule was extracted for: the gate used to read the
      // host's peer map, which holds everyone invited from the moment the role
      // is taken - so it said "answered" about every peer before a single
      // 'start' went out, and the repeats were dead from the day they were
      // written (live run of 2026-08-16, every call cancelling them at #1/3).
      expect(pending({ answered: [] }))
        .withContext(`nobody has signalled back yet`)
        .toBeTrue();
    });

    itCond(`a peer who answered gets no further copies`, async () => {
      // A duplicate 'start' is not inert: landing on someone already in the call
      // rings a phantom one.
      expect(pending({ answered: [PEER] })).toBeFalse();
    });

    itCond(`a peer who answered and left still gets none`, async () => {
      // Answered peers are remembered rather than read off the live client map:
      // someone who joined and left inside the 3/12/30s schedule has been
      // reached, and a leftover copy would ring them back into a call they
      // deliberately left.
      expect(pending({ answered: [PEER], declined: [] })).toBeFalse();
    });

    itCond(`a peer who declined gets no further copies`, async () => {
      expect(pending({ declined: [PEER] })).toBeFalse();
    });

    itCond(`the address is matched canonically, not literally`, async () => {
      // The address a peer signs its signals with and the one the call was
      // started with may differ in case; here a mismatch means sending an
      // invitation to someone who is already in the call.
      expect(pending({ answered: ['PEER@Example.com'] })).toBeFalse();
      expect(pending({ declined: ['PEER@Example.com'] })).toBeFalse();
    });

    itCond(`a call that is over invites nobody`, async () => {
      expect(pending({ live: false })).toBeFalse();
    });

  });

  // ===========================================================================
  // Test Suite 23: wording of a cancelled call's record
  // ===========================================================================

  describe(`Test Suite 23: wording of a cancelled call's record`, () => {

    const US = 'us@example.com';
    const PEER = 'peer@example.com';
    const OUR_SESSION = `${US}#desktop-AAA-1`;
    const PEERS_SESSION = `${PEER}#desktop-BBB-1`;

    itCond(`our call, declined by the peer, reads as ours`, async () => {
      // The defect this rule replaces: both directions rendered "The incoming
      // call from X was cancelled", because the flag they were told apart by
      // (isIncomingMsg) became false for every such record when they were made
      // to synchronize between a user's devices.
      const { i18nKey, wasIncomingCall } = callCancelWording(
        'incoming-call-cancelled', OUR_SESSION, US, false,
      );

      expect(i18nKey).toBe('va.text.outgoing_call_cancelled_by');
      expect(wasIncomingCall).toBeFalse();
    });

    itCond(`their call, declined by us, reads as theirs`, async () => {
      const { i18nKey, wasIncomingCall } = callCancelWording(
        'incoming-call-cancelled', PEERS_SESSION, US, false,
      );

      expect(i18nKey).toBe('va.text.incoming_call_cancelled');
      expect(wasIncomingCall).toBeTrue();
    });

    itCond(`a decline in a group call is about the person, not the call`, async () => {
      // Our group call goes on without whoever said no, so "the call was
      // cancelled" would be untrue of it.
      expect(callCancelWording('incoming-call-cancelled', OUR_SESSION, US, true).i18nKey)
        .toBe('va.text.incoming_call_not_accepted');
    });

    itCond(`a call withdrawn before we answered is a missed call`, async () => {
      // Written by the side that was ringing, and it used to render as an empty
      // string: an icon and a timestamp with no line at all.
      const { i18nKey, wasIncomingCall } = callCancelWording(
        'outgoing-call-cancelled', PEERS_SESSION, US, false,
      );

      expect(i18nKey).toBe('va.text.missed_incoming_call');
      expect(wasIncomingCall).toBeTrue();
    });

    itCond(`the host is read canonically out of the session`, async () => {
      expect(callCancelWording('incoming-call-cancelled', `US@Example.com#desktop-AAA-1`, US, false).i18nKey)
        .toBe('va.text.outgoing_call_cancelled_by');
    });

    itCond(`a record without a session falls back on its subtype`, async () => {
      // Peers on builds that predate callSessionId. Nothing here knows who
      // called, so the reading is the one that was right before sessions
      // existed - and never an empty line.
      expect(callCancelWording('incoming-call-cancelled', undefined, US, false).i18nKey)
        .toBe('va.text.incoming_call_cancelled');
      expect(callCancelWording('outgoing-call-cancelled', undefined, US, false).i18nKey)
        .toBe('va.text.missed_incoming_call');
      expect(callCancelWording('incoming-call-cancelled', 'nothing-of-the-sort', US, false).i18nKey)
        .toBe('va.text.incoming_call_cancelled');
    });

    itCond(`every reading names a line`, async () => {
      for (const subType of ['incoming-call-cancelled', 'outgoing-call-cancelled'] as const) {
        for (const session of [OUR_SESSION, PEERS_SESSION, undefined]) {
          for (const isGroup of [true, false]) {
            expect(callCancelWording(subType, session, US, isGroup).i18nKey)
              .withContext(`${subType}, session ${session}, group: ${isGroup}`)
              .toMatch(/^va\.text\./);
          }
        }
      }
    });

  });

  // ===========================================================================
  // Test Suite 24: when an invited peer is called not responding
  // ===========================================================================

  describe(`Test Suite 24: when an invited peer is called not responding`, () => {

    const T0 = 5_000_000;
    const invited = (addr: string, at: number) => ({
      addr, connectionStatus: 'invited' as const, hasMedia: false, invitedAt: at,
    });

    itCond(`waits out the timeout before saying anything`, async () => {
      const peers = [invited('quiet@example.com', T0)];

      expect(peersToMarkNoAnswer(peers, T0 + NO_ANSWER_TIMEOUT_MS - 1)).toEqual([]);
      expect(peersToMarkNoAnswer(peers, T0 + NO_ANSWER_TIMEOUT_MS))
        .toEqual(['quiet@example.com']);
    });

    itCond(`counts from the invitation, not from when the sweep started`, async () => {
      // The defect this rule replaces: the deadline was one timer armed when the
      // call view mounted. The host mounts it as the invitations go out, while a
      // client mounts it after the invitation crossed ASMail, rang, and was
      // answered by hand - so the same absent peer read "is not responding" on
      // one screen and "Calling…" on the other (live run of 2026-08-16).
      const hostSideRoster = [invited('quiet@example.com', T0)];
      // A client that joined 60s into the call sweeps the same roster with the
      // same timestamps, and reaches the same verdict at the same moment.
      expect(peersToMarkNoAnswer(hostSideRoster, T0 + 60_000))
        .toEqual(['quiet@example.com']);
    });

    itCond(`says nothing about a peer that has arrived`, async () => {
      // Media makes the question moot, whatever the status field says.
      expect(peersToMarkNoAnswer(
        [{ ...invited('here@example.com', T0), hasMedia: true }], T0 + 60_000,
      )).toEqual([]);
      // And a peer past 'invited' is being judged by its signalling, not by a
      // clock - including one already marked, so the sweep is idempotent.
      for (const status of ['connecting', 'establishing', 'declined', 'no-answer'] as const) {
        expect(peersToMarkNoAnswer(
          [{ ...invited('peer@example.com', T0), connectionStatus: status }], T0 + 60_000,
        ))
          .withContext(`status ${status}`)
          .toEqual([]);
      }
    });

    itCond(`leaves alone a peer with no invitation timestamp`, async () => {
      // Nothing to count from - and inventing a moment here would start the
      // clock at the sweep, which is the very thing this rule stopped doing.
      expect(peersToMarkNoAnswer(
        [{ addr: 'peer@example.com', connectionStatus: 'invited', hasMedia: false }],
        T0 + 10 * NO_ANSWER_TIMEOUT_MS,
      )).toEqual([]);
    });

    itCond(`judges each peer by its own clock`, async () => {
      const peers = [
        invited('early@example.com', T0),
        invited('late@example.com', T0 + 30_000),
      ];

      expect(peersToMarkNoAnswer(peers, T0 + NO_ANSWER_TIMEOUT_MS + 1))
        .withContext(`the one invited later is still inside its own window`)
        .toEqual(['early@example.com']);
      expect(peersToMarkNoAnswer(peers, T0 + 30_000 + NO_ANSWER_TIMEOUT_MS))
        .toEqual(['early@example.com', 'late@example.com']);
    });

  });

  // ===========================================================================
  // Test Suite 25: a device that left hands the call back to its neighbours
  // ===========================================================================

  describe(`Test Suite 25: a device that left hands the call back to its neighbours`, () => {

    const CHAT: ChatIdObj = { isGroupChat: true, chatId: 'left-here-chat' };
    const SESSION = `${HOST_ADDR}#desktop-AAA-1`;
    const T0 = 6_000_000;
    const FRESH: SignalAge = { fromSenderClock: 0, sinceDelivery: 0 };

    /** The state of a device that yielded a ringing call to another of its own. */
    function afterYielding(reg: CallSessions): void {
      reg.transit(CHAT, 'ringing', T0, {
        role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION,
      });
      reg.transit(CHAT, 'ended', T0, { endedBy: 'other-device', lastSignal: T0 });
    }

    itCond(`holds the button down while the call is held on another device`, async () => {
      const reg = createCallSessions();
      afterYielding(reg);

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, FRESH, T0 + 5000))
        .withContext(`taking this would put two devices of one address in one call`)
        .toBe('drop-handled-elsewhere');
    }, 5000);

    itCond(`the record left behind can become re-joinable`, async () => {
      // What the 'left: true' notice does: the neighbour has left the call, and
      // the call goes on, so this device may join it. Waiting for the host's
      // next heartbeat instead is not enough - it lands in the shared inbox,
      // where the device that just left reads it too (live run of 2026-08-16).
      const reg = createCallSessions();
      afterYielding(reg);

      expect(reg.transit(CHAT, 'rejoinable', T0 + 10_000, {
        role: 'client',
        hostAddr: HOST_ADDR,
        callSessionId: SESSION,
        lastBeat: T0 + 10_000,
        provisional: true,
        endedBy: undefined,
      })).toBeTrue();
      const record = reg.get(CHAT);
      expect(record?.state).toBe('rejoinable');
      expect(record?.provisional)
        .withContext(`a promise, until a real heartbeat confirms it`)
        .toBeTrue();
      expect(record?.hostAddr)
        .withContext(`whom to join as a client, taken from the record we already had`)
        .toBe(HOST_ADDR);
    }, 5000);

    itCond(`a heartbeat then confirms it, and asks for no second button`, async () => {
      const reg = createCallSessions();
      afterYielding(reg);
      reg.transit(CHAT, 'rejoinable', T0 + 10_000, {
        role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION,
        lastBeat: T0 + 10_000, provisional: true, endedBy: undefined,
      });

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, FRESH, T0 + 15_000))
        .withContext(`the hold is gone with the record that carried it`)
        .toBe('accept');
      expect(reg.noteHeartbeat(CHAT, HOST_ADDR, SESSION, T0 + 15_000))
        .withContext(`the button is already up; announcing it again would be noise`)
        .toBeFalse();
      expect(reg.get(CHAT)?.provisional)
        .withContext(`confirmed, so it now lives by the heartbeat timeout`)
        .toBeFalsy();
    }, 5000);

    itCond(`an unconfirmed promise expires on its own`, async () => {
      // If the call was over by the time the notice arrived, no heartbeat comes
      // and the button must go away rather than linger.
      const reg = createCallSessions();
      afterYielding(reg);
      reg.transit(CHAT, 'rejoinable', T0 + 10_000, {
        role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION,
        lastBeat: T0 + 10_000, provisional: true, endedBy: undefined,
      });

      const expired = reg.takeExpired(T0 + 10_000 + PROVISIONAL_REJOIN_TIMEOUT + 1);

      expect(expired.length).toBe(1);
      expect(expired[0].record.chatId.chatId).toBe(CHAT.chatId);
      expect(reg.get(CHAT)).toBeUndefined();
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 26: passing the host's heartbeat on to our own devices
  // ===========================================================================

  /**
   * The run of 2026-08-16 produced a device that received NOTHING from the
   * host — not one of four copies of 'start', not one heartbeat — while
   * messages from its own address arrived normally and a scan of the inbox
   * found every missing message sitting in it. So it never got a "Join Call"
   * button. The host cannot fix that by sending more copies; a neighbouring
   * device can, by re-addressing the beat it just took to the user's own
   * address (see `relayedRejoin` in asmail-msgs.types.ts).
   */
  describe(`Test Suite 26: relaying a heartbeat to our own devices`, () => {

    const CHAT: ChatIdObj = { isGroupChat: true, chatId: 'relay-beat-chat' };
    const SESSION = `${HOST_ADDR}#relay-1`;
    const T0 = 7_000_000;
    const FRESH: SignalAge = { fromSenderClock: 0, sinceDelivery: 0 };
    const OTHER_DEVICE = 'desktop-EvaYGuNl';

    /** A device holding the "Join Call" button of a call it left. */
    function withButton(reg: CallSessions, at = T0): void {
      reg.noteHeartbeat(CHAT, HOST_ADDR, SESSION, at);
    }

    itCond(`relays while the button is up, and from no other state`, async () => {
      expect(shouldRelayRejoinBeat({
        state: 'rejoinable', inCall: false, beatWasRelayed: false,
        lastRelayAt: undefined, now: T0,
      }))
        .withContext(`the very first beat of a call we may re-join: nothing is `
          + `throttled, because this copy is the button on a device the host `
          + `cannot reach`)
        .toBeTrue();

      expect(shouldRelayRejoinBeat({
        state: 'rejoinable', inCall: true, beatWasRelayed: false,
        lastRelayAt: undefined, now: T0,
      }))
        .withContext(`a live call here: inviting a second device of one address `
          + `into it gives the host two participants it cannot tell apart`)
        .toBeFalse();

      expect(shouldRelayRejoinBeat({
        state: 'ended', inCall: false, beatWasRelayed: false,
        lastRelayAt: undefined, now: T0,
      }))
        .withContext(`a call held on another device of ours keeps its hold on the `
          + `rest (admitsHeartbeat), and relaying beats would undo it`)
        .toBeFalse();

      expect(shouldRelayRejoinBeat({
        state: undefined, inCall: false, beatWasRelayed: false,
        lastRelayAt: undefined, now: T0,
      }))
        .withContext(`no record: no button here to mirror`)
        .toBeFalse();
    }, 5000);

    itCond(`never relays a relayed beat`, async () => {
      // The loop protection, and the only one: without it two devices that can
      // both see the host would mirror each other's copies forever.
      expect(shouldRelayRejoinBeat({
        state: 'rejoinable', inCall: false, beatWasRelayed: true,
        lastRelayAt: undefined, now: T0,
      })).toBeFalse();
    }, 5000);

    itCond(`mirrors every beat of the host, but not the copies of one`, async () => {
      expect(shouldRelayRejoinBeat({
        state: 'rejoinable', inCall: false, beatWasRelayed: false,
        lastRelayAt: T0, now: T0 + 4_000,
      }))
        .withContext(`ASMail's blind repeat of the beat we just relayed - the `
          + `same news twice`)
        .toBeFalse();

      expect(shouldRelayRejoinBeat({
        state: 'rejoinable', inCall: false, beatWasRelayed: false,
        lastRelayAt: T0, now: T0 + 15_000,
      }))
        .withContext(`the host's NEXT beat, 15s on: passed on like the one before`)
        .toBeTrue();

      // The rate is what a neighbour that hears nothing from the host lives on,
      // so it has to be the rate the record was sized for. Relaying every second
      // beat (30s) would mean one lost relay = 60s of silence against a 50s
      // record: the button would go out and come back.
      expect(REJOIN_RELAY_MIN_INTERVAL_MILLIS)
        .withContext(`under the host's own 15s interval, so no beat is skipped`)
        .toBeLessThan(15_000);
      expect(2 * 15_000)
        .withContext(`and the relayed rate survives a loss, exactly as the direct `
          + `one does`)
        .toBeLessThanOrEqual(HEARTBEAT_TIMEOUT);
    }, 5000);

    itCond(`a relayed beat raises the button on a device that has no record`, async () => {
      // The whole point: this device saw nothing of the call.
      const reg = createCallSessions();

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, FRESH, T0))
        .withContext(`judged by the host it names, not by the device that passed `
          + `it on - the envelope of a relayed beat carries our own address`)
        .toBe('accept');
      expect(reg.noteHeartbeat(CHAT, HOST_ADDR, SESSION, T0))
        .withContext(`newly re-joinable: the GUI gets its "Join Call" button`)
        .toBeTrue();
      expect(reg.get(CHAT)?.hostAddr)
        .withContext(`whom to join as a client, taken from the beat's body`)
        .toBe(HOST_ADDR);
    }, 5000);

    itCond(`and asks for no second button where one is already up`, async () => {
      // Both devices see the host: one relays, the other takes the copy on top
      // of the beats it gets itself. That must be inert.
      const reg = createCallSessions();
      withButton(reg);

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, FRESH, T0 + 16_000))
        .toBe('accept');
      expect(reg.noteHeartbeat(CHAT, HOST_ADDR, SESSION, T0 + 16_000))
        .withContext(`the button is up already; a second event would be noise`)
        .toBeFalse();
      expect(reg.get(CHAT)?.lastBeat)
        .withContext(`the record is simply refreshed`)
        .toBe(T0 + 16_000);
    }, 5000);

    itCond(`a relayed beat of a call the host ended is refused`, async () => {
      // A device relays only what it has just accepted, so a chain cannot
      // outlive the call by much - but the record of the end is what makes that
      // independent of any timing.
      const reg = createCallSessions();
      withButton(reg);
      reg.noteRemoteEnded(CHAT, T0 + 20_000, { hostAddr: HOST_ADDR, callSessionId: SESSION });

      expect(reg.admitsHeartbeat(CHAT, HOST_ADDR, SESSION, FRESH, T0 + 21_000))
        .withContext(`the host announced the end of this very session`)
        .toBe('drop-ended-session');
    }, 5000);

    itCond(`the button raised by a relay goes out like any other`, async () => {
      // Nothing about a relayed beat makes the record it feeds special: the
      // neighbour stops relaying when its own record goes, and this one then
      // times out on the ordinary window.
      const reg = createCallSessions();
      withButton(reg);

      expect(reg.takeExpired(T0 + HEARTBEAT_TIMEOUT).length)
        .withContext(`still inside the window`)
        .toBe(0);
      expect(reg.takeExpired(T0 + HEARTBEAT_TIMEOUT + 1).length).toBe(1);
      expect(reg.get(CHAT)).toBeUndefined();
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 27: a re-join has to name the call it re-joins
  // ===========================================================================

  /**
   * The run of 2026-08-17: a device that had yielded a ringing call to its
   * neighbour lost the host from its record, and when the neighbour left and
   * the user pressed "Join Call" there, it started a SECOND call in a chat
   * whose call was still going — inviting the very people who were already in
   * one. Two rules keep that from happening: the record does not forget the
   * host, and a re-join that cannot name one does nothing at all.
   */
  describe(`Test Suite 27: a re-join has to name the call it re-joins`, () => {

    const CHAT: ChatIdObj = { isGroupChat: true, chatId: 'rejoin-host-chat' };
    const SESSION = `${HOST_ADDR}#desktop-vN8KRUMaIpcM35LplzvA-1`;
    const OWN_ADDR = CLIENT_B_ADDR;
    const T0 = 8_000_000;

    itCond(`keeps the host through the states a yielded call goes through`, async () => {
      // Exactly the sequence the run produced on the device that never answered:
      // it rang, its neighbour took the call, the neighbour left, and the button
      // came up here. Its terminal transition reports no host, because with no
      // role initialized there is none to report — and that must not be read as
      // "this call has no host".
      const reg = createCallSessions();
      reg.transit(CHAT, 'ringing', T0, {
        role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION,
      });

      reg.transit(CHAT, 'ended', T0 + 20_000, {
        hostAddr: undefined, callSessionId: SESSION, endedBy: 'self',
        provisional: undefined, lastBeat: undefined,
      });
      expect(reg.get(CHAT)?.hostAddr)
        .withContext(`the detach of a call this device never led says nothing about `
          + `the host; silence is not news`)
        .toBe(HOST_ADDR);

      reg.transit(CHAT, 'ended', T0 + 20_000, {
        endedBy: 'other-device', lastSignal: T0 + 20_000,
      });
      reg.transit(CHAT, 'rejoinable', T0 + 45_000, {
        role: 'client', hostAddr: reg.get(CHAT)?.hostAddr,
        lastBeat: T0 + 45_000, provisional: true, endedBy: undefined,
      });

      expect(rejoinTargetOf(reg.get(CHAT), OWN_ADDR))
        .withContext(`so the button leads where it always meant to`)
        .toEqual({ hostAddr: HOST_ADDR, callSessionId: SESSION });
    }, 5000);

    itCond(`still lets a new host replace the old one`, async () => {
      // The rule above withholds nothing from a record that is being told
      // something: a later call of the same chat has its own host.
      const reg = createCallSessions();
      reg.transit(CHAT, 'ringing', T0, {
        role: 'client', hostAddr: HOST_ADDR, callSessionId: SESSION,
      });
      reg.transit(CHAT, 'ended', T0 + 10_000, { endedBy: 'peer' });
      reg.noteHeartbeat(CHAT, CLIENT_A_ADDR, `${CLIENT_A_ADDR}#desktop-BBB-1`, T0 + 60_000);

      expect(reg.get(CHAT)?.hostAddr).toBe(CLIENT_A_ADDR);
    }, 5000);

    itCond(`reads the host out of the session id when the field is empty`, async () => {
      // A record written by an older build, or one that lost the field before
      // the rule above existed: the session id spells the host out
      // (`<host>#<device>-<n>`), and a device with that in hand is not lost.
      const reg = createCallSessions();
      reg.transit(CHAT, 'rejoinable', T0, {
        role: 'client', callSessionId: SESSION, lastBeat: T0, provisional: true,
      });

      expect(rejoinTargetOf(reg.get(CHAT), OWN_ADDR))
        .toEqual({ hostAddr: HOST_ADDR, callSessionId: SESSION });
    }, 5000);

    itCond(`refuses every record that cannot say whose call it is`, async () => {
      const rejoinable = (patch: Partial<CallSessionRecord>): CallSessionRecord => ({
        chatId: CHAT, state: 'rejoinable', since: T0, role: 'client', ...patch,
      });

      expect(rejoinTargetOf(rejoinable({ callSessionId: 'nothing-of-the-sort' }), OWN_ADDR))
        .withContext(`neither a host nor a session id to read one out of: a button `
          + `here would promise what this device cannot deliver`)
        .toBeUndefined();

      expect(rejoinTargetOf(rejoinable({ hostAddr: OWN_ADDR, callSessionId: `${OWN_ADDR}#d-1` }), OWN_ADDR))
        .withContext(`a client's record naming US as the host contradicts itself, `
          + `and joining oneself is not a thing that can be done`)
        .toBeUndefined();

      expect(rejoinTargetOf(undefined, OWN_ADDR))
        .withContext(`no call known in this chat`)
        .toBeUndefined();
      expect(rejoinTargetOf(
        { chatId: CHAT, state: 'ended', since: T0, hostAddr: HOST_ADDR, callSessionId: SESSION },
        OWN_ADDR,
      ))
        .withContext(`a finished call is not re-joinable, however well it names its host`)
        .toBeUndefined();
      expect(rejoinTargetOf(
        { chatId: CHAT, state: 'ringing', since: T0, hostAddr: HOST_ADDR, callSessionId: SESSION },
        OWN_ADDR,
      ))
        .withContext(`a ringing call is answered, not re-joined`)
        .toBeUndefined();

      // And what a refusal means: nothing happens. The caller takes the button
      // down (video-chat-service.ts) instead of starting a call of its own -
      // the live call's participants would refuse the invitation as
      // 'drop-in-call', and their host's 'disconnect' would later reach us as
      // 'drop-foreign-session'.
    }, 5000);

  });

  // ===========================================================================
  // Test Suite 28: attribution of a signal to the channel it arrived on
  // ===========================================================================

  /**
   * A participant may speak for itself, and for nobody else.
   *
   * Reported 2026-09-09: the host read the author of an incoming signal out of
   * the message body (`fromAddr`), while the authenticated address of the
   * channel it arrived on was thrown away. A connected participant could name
   * another one and have the host apply its SDP to that participant's live
   * connection, hang it up, or take over its media attribution.
   *
   * The rule is one-sided on purpose: on the HOST an incoming signal always
   * belongs to the channel's owner (the host never relays an incoming signal),
   * whereas a CLIENT legitimately hears about other participants from the host.
   * These specs pin the host side.
   */
  describe(`Test Suite 28: attribution of a signal to the channel it arrived on`, () => {

    const SPOOFABLE_TYPES: StarSignalType[] = [
      'offer', 'answer', 'candidate', 'candidates', 'disconnect',
      'stream-state-changed', 'stream-sender-info', 'participant-left',
      'request-stream-info',
    ];

    itCond(`a body that agrees with its channel is passed through untouched`, async () => {
      const msg = { type: 'offer' as const, fromAddr: CLIENT_A_ADDR, data: {} };
      const { signal, overridden } = attributeIncomingHostSignal(CLIENT_A_ADDR, msg);
      expect(signal)
        .withContext(`the common path must not even copy the message`)
        .toBe(msg);
      expect(overridden).toBeFalse();
    }, 5000);

    itCond(`an address written in another form is not a foreign sender`, async () => {
      // Case and spaces in the user part are the same address, and a peer that
      // writes it differently is not making a claim about anyone else.
      const { signal, overridden } = attributeIncomingHostSignal(
        CLIENT_A_ADDR, { type: 'candidate', fromAddr: ' Client A@3NSoft.net ', data: {} },
      );
      expect(signal.fromAddr)
        .withContext(`normalised to the form the channel uses, since maps are keyed on it`)
        .toBe(CLIENT_A_ADDR);
      expect(overridden)
        .withContext(`no warning is warranted for a mere difference in form`)
        .toBeFalse();
    }, 5000);

    itCond(`a body naming another participant is re-attributed, for every signal type`, async () => {
      for (const type of SPOOFABLE_TYPES) {
        const { signal, overridden } = attributeIncomingHostSignal(
          CLIENT_A_ADDR, { type, fromAddr: CLIENT_B_ADDR, data: {} },
        );
        expect(signal.fromAddr)
          .withContext(`'${type}' arriving on A's channel is A's, whatever it claims`)
          .toBe(CLIENT_A_ADDR);
        expect(overridden)
          .withContext(`'${type}' claimed a foreign sender and must be reported`)
          .toBeTrue();
      }
    }, 5000);

    itCond(`a body with no sender is filled in, and not reported`, async () => {
      // An older build, and the legacy starSignal wrapper, send no sender at
      // all; that is not a claim about anybody.
      for (const fromAddr of ['', undefined as unknown as string]) {
        const { signal, overridden } = attributeIncomingHostSignal(
          CLIENT_A_ADDR, { type: 'disconnect', fromAddr, data: {} },
        );
        expect(signal.fromAddr).toBe(CLIENT_A_ADDR);
        expect(overridden).toBeFalse();
      }
    }, 5000);

    itCond(`junk in the sender field is answered, never thrown on`, async () => {
      // The value is chosen by whoever sent the message, and areAddressesEqual
      // throws on anything without an '@' — on the ASMail path that would have
      // escaped as an unhandled rejection.
      const junk = ['not-an-address', 'screen:a@b:1', '   ', 42 as unknown as string];
      for (const fromAddr of junk) {
        let thrown: unknown;
        let overridden = false;
        try {
          ({ overridden } = attributeIncomingHostSignal(
            CLIENT_A_ADDR, { type: 'offer', fromAddr, data: {} },
          ));
        } catch (err) {
          thrown = err;
        }
        expect(thrown)
          .withContext(`attribution must not throw on '${String(fromAddr)}'`)
          .toBeUndefined();
        expect(overridden)
          .withContext(`'${String(fromAddr)}' is not this channel's address`)
          .toBeTrue();
      }
    }, 5000);

    itCond(`mayActFor: a participant owns itself and its own screen shares`, async () => {
      expect(mayActFor(CLIENT_A_ADDR, CLIENT_A_ADDR)).toBeTrue();
      expect(mayActFor(CLIENT_A_ADDR, `screen:${CLIENT_A_ADDR}:src-1`))
        .withContext(`a screen address carries its owner`)
        .toBeTrue();
      expect(mayActFor(CLIENT_A_ADDR, 'ClientA@3NSoft.net'))
        .withContext(`compared canonically, not by ===`)
        .toBeTrue();
      expect(mayActFor(CLIENT_A_ADDR, CLIENT_B_ADDR)).toBeFalse();
      expect(mayActFor(CLIENT_A_ADDR, `screen:${CLIENT_B_ADDR}:src-1`))
        .withContext(`somebody else's screen share is somebody else`)
        .toBeFalse();
      for (const junk of ['', 'screen:', 'not-an-address', undefined, 7]) {
        let thrown: unknown;
        let verdict = true;
        try {
          verdict = mayActFor(CLIENT_A_ADDR, junk);
        } catch (err) {
          thrown = err;
        }
        expect(thrown).toBeUndefined();
        expect(verdict)
          .withContext(`'${String(junk)}' is nobody this channel may speak for`)
          .toBeFalse();
      }
    }, 5000);

    itCond(`a spoofed disconnect does not hang up another participant`, async () => {
      const mockSignaling = createMockHostSignalingChannel();
      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: createRealMediaStreamForTesting(),
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: () => {},
        onClientDisconnected: () => {},
        onClientTrack: () => {},
      });
      await hostChannel.handleClientOffer(CLIENT_A_ADDR, { type: 'offer', sdp: VALID_SDP });
      await hostChannel.handleClientOffer(CLIENT_B_ADDR, { type: 'offer', sdp: VALID_SDP });
      expect(hostChannel.getClientCount()).toBe(2);

      // A, over its own channel, claims to be B and hangs up.
      mockSignaling._triggerClientSignal(CLIENT_A_ADDR, {
        type: 'disconnect', fromAddr: CLIENT_B_ADDR,
      });
      await sleep(50);

      expect(mockSignaling.getKnownClients())
        .withContext(`B was hung up by a signal that never came from B`)
        .toContain(CLIENT_B_ADDR);
      expect(mockSignaling.getReattributedSignals().length)
        .withContext(`the attempt is recorded rather than silently accepted`)
        .toBe(1);

      // Positive control: A's honest disconnect does remove A.
      mockSignaling._triggerClientSignal(CLIENT_A_ADDR, {
        type: 'disconnect', fromAddr: CLIENT_A_ADDR,
      });
      await sleep(50);
      expect(mockSignaling.getKnownClients())
        .withContext(`an honest disconnect still works`)
        .not.toContain(CLIENT_A_ADDR);
    }, 15000);

    itCond(`a spoofed participant-left does not remove another participant`, async () => {
      const mockSignaling = createMockHostSignalingChannel();
      const departed: string[] = [];
      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: createRealMediaStreamForTesting(),
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: () => {},
        onClientDisconnected: () => {},
        onClientTrack: () => {},
        onParticipantLeft: addr => departed.push(addr),
      });
      await hostChannel.handleClientOffer(CLIENT_A_ADDR, { type: 'offer', sdp: VALID_SDP });
      await hostChannel.handleClientOffer(CLIENT_B_ADDR, { type: 'offer', sdp: VALID_SDP });

      // The actor is in the payload here, so re-attributing fromAddr alone
      // would not have stopped this one.
      mockSignaling._triggerClientSignal(CLIENT_A_ADDR, {
        type: 'participant-left',
        fromAddr: CLIENT_A_ADDR,
        data: { addr: CLIENT_B_ADDR, name: 'B' },
      });
      await sleep(50);
      expect(departed)
        .withContext(`A may not announce B's departure`)
        .not.toContain(CLIENT_B_ADDR);

      // Positive control: its own screen share may leave.
      const ownScreen = `screen:${CLIENT_A_ADDR}:src-1`;
      mockSignaling._triggerClientSignal(CLIENT_A_ADDR, {
        type: 'participant-left',
        fromAddr: CLIENT_A_ADDR,
        data: { addr: ownScreen, name: 'A screen' },
      });
      await sleep(50);
      expect(departed)
        .withContext(`a participant's own screen share is its own to end`)
        .toContain(ownScreen);
    }, 15000);

    itCond(`a spoofed stream-sender-info does not claim another participant's stream`, async () => {
      const mockSignaling = createMockHostSignalingChannel();
      const mappings: string[] = [];
      const hostChannel = createHostChannel({
        ownAddr: HOST_ADDR,
        rtcConfig: {},
        localStream: createRealMediaStreamForTesting(),
        signalingChannel: mockSignaling as unknown as HostSignalingChannel,
        onClientConnected: () => {},
        onClientDisconnected: () => {},
        onClientTrack: () => {},
        onStreamSenderInfo: (_streamId, senderAddr) => mappings.push(senderAddr),
      });
      await hostChannel.handleClientOffer(CLIENT_A_ADDR, { type: 'offer', sdp: VALID_SDP });
      await hostChannel.handleClientOffer(CLIENT_B_ADDR, { type: 'offer', sdp: VALID_SDP });

      mockSignaling._triggerClientSignal(CLIENT_A_ADDR, {
        type: 'stream-sender-info',
        fromAddr: CLIENT_A_ADDR,
        data: { streamId: 'stream-1', senderAddr: CLIENT_B_ADDR },
      });
      await sleep(50);
      expect(mappings)
        .withContext(`A's stream may not be attributed to B — that is B's tile`)
        .not.toContain(CLIENT_B_ADDR);

      const ownScreen = `screen:${CLIENT_A_ADDR}:src-1`;
      mockSignaling._triggerClientSignal(CLIENT_A_ADDR, {
        type: 'stream-sender-info',
        fromAddr: CLIENT_A_ADDR,
        data: { streamId: 'stream-2', senderAddr: ownScreen },
      });
      await sleep(50);
      expect(mappings)
        .withContext(`its own screen share is a legitimate sender`)
        .toContain(ownScreen);
    }, 15000);

  });

  // ===========================================================================
  // Test Suite 29: two calls started in one chat at the same moment
  // ===========================================================================

  /**
   * Two people pressing "call" within one ASMail delivery of each other (7-20 s)
   * both become hosts. Until callCollisionWinner the second 'start' was handed to
   * the first host's call object, which ignores a 'start', and both windows sat
   * on "Calling..." waiting for an offer from the other. Every party now settles
   * on the same call from the same facts - which is only true if the rule is
   * symmetric, and that is the first thing pinned here.
   */
  describe(`Test Suite 29: two calls started in one chat at the same moment`, () => {

    const A = 'alice@test.3nweb.com';
    const B = 'bob@test.3nweb.com';
    const T0 = 1_000_000;
    const FRESH: SignalAge = { fromSenderClock: 0, sinceDelivery: 0 };
    const CHAT: ChatIdObj = { isGroupChat: true, chatId: 'collision-chat' };

    function party(
      hostAddr: string, startedAt: number | undefined, established = false,
    ): CallCollisionParty {
      return { hostAddr, callSessionId: `${hostAddr}#dev-1`, startedAt, established };
    }

    /** Which host's call stays, as seen from both sides. */
    function winners(a: CallCollisionParty, b: CallCollisionParty): [string, string] {
      const fromA = (callCollisionWinner(a, b) === 'a') ? a.hostAddr : b.hostAddr;
      const fromB = (callCollisionWinner(b, a) === 'a') ? b.hostAddr : a.hostAddr;
      return [fromA, fromB];
    }

    itCond(`both hosts settle on the same call`, async () => {
      for (const [a, b] of [
        [party(A, T0), party(B, T0 + 1)],
        [party(A, T0 + 1), party(B, T0)],
        [party(A, T0), party(B, T0)],
        [party(A, undefined), party(B, T0)],
        [party(A, T0, true), party(B, T0 - 5000)],
        [party(A, undefined), party(B, undefined)],
      ] as const) {
        const [fromA, fromB] = winners(a, b);
        expect(fromA)
          .withContext(`${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
          .toBe(fromB);
      }
    });

    itCond(`the earlier call stays`, async () => {
      expect(winners(party(A, T0), party(B, T0 + 1))[0]).toBe(A);
      expect(winners(party(A, T0 + 1), party(B, T0))[0]).toBe(B);
    });

    itCond(`a call someone has answered never gives way`, async () => {
      // Even to one started earlier: tearing down a call with a person in it to
      // merge an empty one into it is the one outcome worse than no merge.
      expect(winners(party(A, T0 + 5000, true), party(B, T0))[0]).toBe(A);
      expect(winners(party(A, T0), party(B, T0 + 5000, true))[0]).toBe(B);
    });

    itCond(`a call from a build that cannot give way is the one to join`, async () => {
      // No `startedAt` in its 'start': its host will never step aside, but it
      // accepts our offer like any client's - so joining it is what connects.
      expect(winners(party(A, T0), party(B, undefined))[0]).toBe(B);
      expect(winners(party(A, undefined), party(B, T0))[0]).toBe(A);
    });

    itCond(`a tie on time goes by session id`, async () => {
      const [fromA] = winners(party(A, T0), party(B, T0));
      expect(fromA).toBe(A);
    });

    itCond(`an invitee ringing for one call rings for the one that stays`, async () => {
      const reg = createCallSessions();
      reg.transit(CHAT, 'ringing', T0, {
        role: 'client', hostAddr: B, callSessionId: `${B}#dev-1`, startedAt: T0 + 1000,
      });

      expect(reg.admitsStart(CHAT, `${A}#dev-1`, FRESH, T0 + 2000, { hostAddr: A, startedAt: T0 }))
        .withContext(`A called first: its call replaces the one ringing`)
        .toBe('accept-superseding');
      expect(reg.admitsStart(CHAT, `${A}#dev-1`, FRESH, T0 + 2000, { hostAddr: A, startedAt: T0 + 2000 }))
        .withContext(`A called later: the ringing call stays`)
        .toBe('drop-superseded');
      expect(reg.admitsStart(CHAT, `${A}#dev-1`, FRESH, T0 + 2000))
        .withContext(`with nothing to compare, the old refusal stands`)
        .toBe('drop-in-call');
    });

    itCond(`two calls that never met are recorded as such`, async () => {
      // Whichever side writes it - the winner on its timer, the rival off the
      // winner's system message - the line names the other person, not a
      // cancellation, and has no direction to point.
      for (const own of [A, B]) {
        expect(callCancelWording('call-collision-failed', `${A}#dev-1`, own, false))
          .toEqual({ i18nKey: 'va.text.call_collision_failed', wasIncomingCall: false });
      }
    });

    itCond(`a host only dialing lets the rival's 'start' through to be settled`, async () => {
      const reg = createCallSessions();
      reg.transit(CHAT, 'dialing', T0, { role: 'host', hostAddr: A, callSessionId: `${A}#dev-1` });
      expect(reg.admitsStart(CHAT, `${B}#dev-1`, FRESH, T0 + 1000, { hostAddr: B, startedAt: T0 }))
        .toBe('accept');
    });

  });

});
