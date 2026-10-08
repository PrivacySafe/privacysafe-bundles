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

/**
 * WebRTC Mocks for Star Architecture Testing
 *
 * Provides mock implementations of:
 * - RTCPeerConnection
 * - MediaStream
 * - MediaStreamTrack
 * - RTCRtpSender
 * - Signaling Channels
 */

import { attributeIncomingHostSignal } from '@video/common/services/signaling-channel-core';
import type { StarSignalMessage } from '@video/common/types/star.types';

// =============================================================================
// Mock RTCRtpSender
// =============================================================================

export class MockRTCRtpSender {
  track: MediaStreamTrack | null;
  dtmf: RTCDTMFSender | null = null;
  transform: unknown = null;
  transport: RTCDtlsTransport | null = null;

  constructor(track: MediaStreamTrack) {
    this.track = track;
  }

  getParameters(): RTCRtpSendParameters {
    return {} as RTCRtpSendParameters;
  }

  setParameters(): Promise<void> {
    return Promise.resolve();
  }

  getStats(): Promise<RTCStatsReport> {
    return Promise.resolve(new Map() as unknown as RTCStatsReport);
  }

  replaceTrack(): Promise<void> {
    return Promise.resolve();
  }

  setStreams(): void {}
}

// =============================================================================
// Mock MediaStreamTrack
// =============================================================================

export class MockMediaStreamTrack {
  id: string;
  kind: 'audio' | 'video';
  label: string;
  enabled = true;
  muted = false;
  contentHint = '';
  readyState: MediaStreamTrackState = 'live';

  constructor(kind: 'audio' | 'video', id?: string) {
    this.kind = kind;
    this.id = id || `track-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.label = `${kind}-track-${this.id}`;
  }

  clone(): MediaStreamTrack {
    const cloned = new MockMediaStreamTrack(this.kind);
    return cloned as MediaStreamTrack;
  }

  stop(): void {
    this.readyState = 'ended';
    if (this.onended) {
      this.onended(new Event('ended'));
    }
  }

  getCapabilities(): MediaTrackCapabilities {
    return {};
  }

  getConstraints(): MediaTrackConstraints {
    return {};
  }

  getSettings(): MediaTrackSettings {
    return {};
  }

  applyConstraints(): Promise<void> {
    return Promise.resolve();
  }

  // Event handlers
  onended: ((this: MediaStreamTrack, ev: Event) => unknown) | null = null;
  onmute: ((this: MediaStreamTrack, ev: Event) => unknown) | null = null;
  onunmute: ((this: MediaStreamTrack, ev: Event) => unknown) | null = null;

  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true;
  }
}

// =============================================================================
// Mock MediaStream
// =============================================================================

export class MockMediaStream {
  id: string;
  active = true;

  private tracks: MediaStreamTrack[] = [];

  constructor(idOrTracks?: string | MediaStreamTrack[], tracks?: MediaStreamTrack[]) {
    if (typeof idOrTracks === 'string') {
      this.id = idOrTracks;
      if (tracks) {
        this.tracks = [...tracks];
      }
    } else if (Array.isArray(idOrTracks)) {
      this.id = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      this.tracks = [...idOrTracks];
    } else {
      this.id = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    }
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter(t => t.kind === 'audio');
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter(t => t.kind === 'video');
  }

  getTrackById(id: string): MediaStreamTrack | null {
    return this.tracks.find(t => t.id === id) || null;
  }

  addTrack(track: MediaStreamTrack): void {
    if (!this.tracks.includes(track)) {
      this.tracks.push(track);
    }
  }

  removeTrack(track: MediaStreamTrack): void {
    const idx = this.tracks.indexOf(track);
    if (idx !== -1) {
      this.tracks.splice(idx, 1);
    }
  }

  clone(): MediaStream {
    const clonedTracks = this.tracks.map(t => t.clone());
    return new MockMediaStream(this.id + '-clone', clonedTracks) as unknown as MediaStream;
  }

  // Event handlers (stubs)
  onaddtrack: ((this: MediaStream, ev: MediaStreamTrackEvent) => unknown) | null = null;
  onremovetrack: ((this: MediaStream, ev: MediaStreamTrackEvent) => unknown) | null = null;

  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true;
  }
}

// =============================================================================
// Mock RTCPeerConnection
// =============================================================================

export class MockRTCPeerConnection {
  // State
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'new';
  signalingState: RTCSignalingState = 'stable';
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  currentLocalDescription: RTCSessionDescription | null = null;
  currentRemoteDescription: RTCSessionDescription | null = null;
  pendingLocalDescription: RTCSessionDescription | null = null;
  pendingRemoteDescription: RTCSessionDescription | null = null;

  // Event handlers
  ontrack: ((this: RTCPeerConnection, ev: RTCTrackEvent) => unknown) | null = null;
  onicecandidate: ((this: RTCPeerConnection, ev: RTCPeerConnectionIceEvent) => unknown) | null = null;
  onconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  oniceconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  onicegatheringstatechange: ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  onsignalingstatechange: ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  onnegotiationneeded: ((this: RTCPeerConnection, ev: Event) => unknown) | null = null;
  ondatachannel: ((this: RTCPeerConnection, ev: RTCDataChannelEvent) => unknown) | null = null;

  // Internal state
  private senders: RTCRtpSender[] = [];
  private receivers: RTCRtpReceiver[] = [];
  private transceivers: RTCRtpTransceiver[] = [];

  // Spy-like tracking for assertions
  public addTrackCalls: Array<{ track: MediaStreamTrack; streams: MediaStream[] }> = [];
  public removeTrackCalls: RTCRtpSender[] = [];

  addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender {
    const sender = new MockRTCRtpSender(track) as unknown as RTCRtpSender;
    this.senders.push(sender);
    this.addTrackCalls.push({ track, streams });
    return sender;
  }

  removeTrack(sender: RTCRtpSender): void {
    const idx = this.senders.indexOf(sender);
    if (idx !== -1) {
      this.senders.splice(idx, 1);
    }
    this.removeTrackCalls.push(sender);
  }

  getSenders(): RTCRtpSender[] {
    return [...this.senders];
  }

  getReceivers(): RTCRtpReceiver[] {
    return [...this.receivers];
  }

  getTransceivers(): RTCRtpTransceiver[] {
    return [...this.transceivers];
  }

  addTransceiver(): RTCRtpTransceiver {
    return {} as RTCRtpTransceiver;
  }

  async createOffer(_options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
    void _options;
    return {
      type: 'offer',
      sdp: 'v=0\r\no=- 123456 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n',
    };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return {
      type: 'answer',
      sdp: 'v=0\r\no=- 123456 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n',
    };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description as RTCSessionDescription;
    this.currentLocalDescription = description as RTCSessionDescription;
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description as RTCSessionDescription;
    this.currentRemoteDescription = description as RTCSessionDescription;
  }

  async addIceCandidate(_candidate: RTCIceCandidateInit): Promise<void> {
    void _candidate;
    // Mock: do nothing
  }

  close(): void {
    this.connectionState = 'closed';
    this.signalingState = 'closed';
  }

  getConfiguration(): RTCConfiguration {
    return {};
  }

  setConfiguration(): void {}

  restartIce(): void {}

  createDataChannel(): RTCDataChannel {
    return {} as RTCDataChannel;
  }

  getStats(): Promise<RTCStatsReport> {
    return Promise.resolve(new Map() as unknown as RTCStatsReport);
  }

  // Event handling stubs
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(): boolean {
    return true;
  }

  // =========================================================================
  // Helper methods for testing
  // =========================================================================

  /**
   * Simulate incoming track event (for testing ontrack handler)
   */
  simulateIncomingTrack(track: MediaStreamTrack, stream: MediaStream): void {
    if (this.ontrack) {
      const event = {
        track,
        streams: [stream],
        receiver: {} as RTCRtpReceiver,
        transceiver: {} as RTCRtpTransceiver,
      } as unknown as RTCTrackEvent;
      this.ontrack.call(this as unknown as RTCPeerConnection, event);
    }
  }

  /**
   * Simulate connection state change
   */
  simulateConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    if (this.onconnectionstatechange) {
      this.onconnectionstatechange.call(
        this as unknown as RTCPeerConnection,
        new Event('connectionstatechange')
      );
    }
  }

  /**
   * Simulate ICE candidate generation
   */
  simulateIceCandidate(candidate: RTCIceCandidateInit): void {
    if (this.onicecandidate) {
      const event = {
        candidate: candidate as RTCIceCandidate,
      } as unknown as RTCPeerConnectionIceEvent;
      this.onicecandidate.call(this as unknown as RTCPeerConnection, event);
    }
  }

  /**
   * Reset tracking arrays
   */
  resetTracking(): void {
    this.addTrackCalls = [];
    this.removeTrackCalls = [];
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a mock RTCPeerConnection
 */
export function createMockPeerConnection(): MockRTCPeerConnection {
  return new MockRTCPeerConnection();
}

/**
 * Create a mock MediaStream with optional ID and tracks
 */
export function createMockMediaStream(id?: string): MockMediaStream {
  const stream = new MockMediaStream(id);
  // Add default audio and video tracks
  stream.addTrack(new MockMediaStreamTrack('audio') as unknown as MediaStreamTrack);
  stream.addTrack(new MockMediaStreamTrack('video') as unknown as MediaStreamTrack);
  return stream;
}

/**
 * Create a mock MediaStreamTrack
 */
export function createMockMediaStreamTrack(kind: 'audio' | 'video', id?: string): MockMediaStreamTrack {
  return new MockMediaStreamTrack(kind, id);
}

// =============================================================================
// Mock Signaling Channels
// =============================================================================

/**
 * Create a mock ClientSignalingChannel for testing
 */
export function createMockClientSignalingChannel() {
  let signalHandler: ((signal: unknown) => void) | null = null;

  return {
    sendDescription: jasmine.createSpy('sendDescription').and.returnValue(Promise.resolve()),
    // sendAnswer/sendSignal/setDataChannel are used by client-channel.ts on
    // renegotiation and state-change paths. They are here so the mock covers the
    // whole ClientSignalingChannel interface: it is passed in as `unknown as
    // ClientSignalingChannel`, so a missing method is not a compile error but a
    // "not a function" at runtime.
    sendAnswer: jasmine.createSpy('sendAnswer').and.returnValue(Promise.resolve(true)),
    sendSignal: jasmine.createSpy('sendSignal').and.returnValue(Promise.resolve(true)),
    setDataChannel: jasmine.createSpy('setDataChannel'),
    sendCandidate: jasmine.createSpy('sendCandidate').and.returnValue(Promise.resolve()),
    handleIncomingSignal: jasmine.createSpy('handleIncomingSignal'),
    handleWebRTCMsg: jasmine.createSpy('handleWebRTCMsg'),
    onSignal: jasmine.createSpy('onSignal').and.callFake((handler: (signal: unknown) => void) => {
      signalHandler = handler;
      return () => {
        signalHandler = null;
      };
    }),
    close: jasmine.createSpy('close').and.callFake(() => {
      signalHandler = null;
    }),
    // Helper to trigger signal handler
    _triggerSignal: (signal: unknown) => {
      if (signalHandler) {
        signalHandler(signal);
      }
    },
  };
}

/**
 * Create a mock HostSignalingChannel for testing
 */
export function createMockHostSignalingChannel() {
  const clientHandlers = new Map<string, StarSignalHandlerForMock>();
  let globalHandler: StarSignalHandlerForMock | null = null;
  // Signals whose body named a participant other than the channel's owner, and
  // which were therefore re-attributed. Kept so a spec can assert on the fact
  // itself rather than on "nothing happened".
  const reattributedSignals: { clientAddr: string; claimedFrom: string }[] = [];
  // The host channel registers every client it accepts an offer from, and the
  // real implementation broadcasts to exactly this set. Omitting these methods
  // made handleClientOffer() throw "addClient is not a function", which is not
  // caught by the compiler: the mock is handed over as `unknown as
  // HostSignalingChannel`.
  const knownClients = new Set<string>();

  return {
    addClient: jasmine.createSpy('addClient').and.callFake((clientAddr: string) => {
      knownClients.add(clientAddr);
    }),
    removeClient: jasmine.createSpy('removeClient').and.callFake((clientAddr: string) => {
      knownClients.delete(clientAddr);
    }),
    setClientDataChannel: jasmine.createSpy('setClientDataChannel'),
    /** Clients the host has registered — what broadcastSignal() would reach. */
    getKnownClients: () => Array.from(knownClients),
    sendSignalToClient: jasmine.createSpy('sendSignalToClient').and.returnValue(Promise.resolve()),
    sendAnswerToClient: jasmine.createSpy('sendAnswerToClient').and.returnValue(Promise.resolve()),
    sendCandidateToClient: jasmine.createSpy('sendCandidateToClient').and.returnValue(Promise.resolve()),
    broadcastSignal: jasmine.createSpy('broadcastSignal').and.returnValue(Promise.resolve()),
    handleIncomingSignal: jasmine.createSpy('handleIncomingSignal'),
    handleWebRTCMsg: jasmine.createSpy('handleWebRTCMsg'),
    registerClientHandler: jasmine.createSpy('registerClientHandler').and.callFake(
      (clientAddr: string, handler: StarSignalHandlerForMock) => {
        if (clientAddr === '*') {
          globalHandler = handler;
        } else {
          clientHandlers.set(clientAddr, handler);
        }
        return () => {
          if (clientAddr === '*') {
            globalHandler = null;
          } else {
            clientHandlers.delete(clientAddr);
          }
        };
      }
    ),
    close: jasmine.createSpy('close').and.callFake(() => {
      clientHandlers.clear();
      knownClients.clear();
      reattributedSignals.length = 0;
      globalHandler = null;
    }),
    /**
     * Delivers a signal as if it had arrived on `clientAddr`'s channel.
     *
     * Runs the same attribution the real HostSignalingChannel runs before any
     * handler sees a signal. It used to hand the handler the raw body and drop
     * `clientAddr` — reproducing, in the harness, the very defect that was
     * reported: a spec exercising a spoofed `fromAddr` would have passed no
     * matter what the production code did.
     */
    _triggerClientSignal: (clientAddr: string, signal: unknown) => {
      const { signal: authentic, overridden } = attributeIncomingHostSignal(
        clientAddr, signal as StarSignalMessage,
      );
      if (overridden) {
        reattributedSignals.push({
          clientAddr,
          claimedFrom: (signal as StarSignalMessage).fromAddr,
        });
      }
      clientHandlers.get(clientAddr)?.(authentic, clientAddr);
      globalHandler?.(authentic, clientAddr);
    },
    /** Signals whose claimed sender was overridden; see _triggerClientSignal. */
    getReattributedSignals: () => reattributedSignals.slice(),
  };
}

type StarSignalHandlerForMock = (
  signal: StarSignalMessage, authenticatedFrom: string,
) => void;

// =============================================================================
// Type for mock signaling channels
// =============================================================================

export type MockClientSignalingChannel = ReturnType<typeof createMockClientSignalingChannel>;
export type MockHostSignalingChannel = ReturnType<typeof createMockHostSignalingChannel>;

// =============================================================================
// Valid SDP for Testing
// =============================================================================

/**
 * A valid SDP string that passes browser RTCPeerConnection validation.
 * Includes DTLS fingerprint, ICE credentials, and BUNDLE grouping
 * required by modern browsers.
 * Use this in tests instead of 'mock', 'mock-sdp', etc.
 */
export const VALID_SDP = [
  'v=0',
  'o=- 123456 1 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'a=msid-semantic: WMS',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:efghijklmnopqrstuvwxyz12',
  'a=fingerprint:sha-256 A1:B2:C3:D4:E5:F6:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23',
  'a=setup:actpass',
  'a=mid:0',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=sendrecv',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:efghijklmnopqrstuvwxyz12',
  'a=fingerprint:sha-256 A1:B2:C3:D4:E5:F6:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23',
  'a=setup:actpass',
  'a=mid:1',
  'a=rtcp-mux',
  'a=rtpmap:96 VP8/90000',
  'a=sendrecv',
].join('\r\n') + '\r\n';

/**
 * A valid SDP ANSWER string for testing.
 * Uses 'a=setup:active' instead of 'actpass' (required for answers).
 *
 * NOT usable as an answer to an offer a real RTCPeerConnection generated: the
 * browser requires the answer's m-lines and mids to match that offer, and this
 * string describes its own session. setRemoteDescription() rejects it, and
 * applyAnswerWithRecovery() then rolls the offer back — which looks like
 * "the answer was ignored" rather than an error. To answer a real offer, feed it
 * to a second RTCPeerConnection and take its createAnswer() (see
 * "Client: applies SDP Answer received from Host" in tests/video-chat.ts).
 */
export const VALID_SDP_ANSWER = [
  'v=0',
  'o=- 123456 1 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'a=msid-semantic: WMS',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:efghijklmnopqrstuvwxyz12',
  'a=fingerprint:sha-256 A1:B2:C3:D4:E5:F6:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23',
  'a=setup:active',
  'a=mid:0',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=sendrecv',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:efghijklmnopqrstuvwxyz12',
  'a=fingerprint:sha-256 A1:B2:C3:D4:E5:F6:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23',
  'a=setup:active',
  'a=mid:1',
  'a=rtcp-mux',
  'a=rtpmap:96 VP8/90000',
  'a=sendrecv',
].join('\r\n') + '\r\n';

// =============================================================================
// Real MediaStream/MediaStreamTrack for Testing
// =============================================================================

/**
 * Creates a REAL MediaStreamTrack for testing.
 * Uses Canvas API for video and AudioContext for audio.
 * 
 * This is necessary because the browser's RTCPeerConnection.addTrack()
 * validates that the track is a genuine MediaStreamTrack instance.
 */
export function createRealMediaStreamTrack(kind: 'audio' | 'video'): MediaStreamTrack {
  if (kind === 'video') {
    // Create a canvas and capture its stream
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 320, 240);
    }
    const stream = canvas.captureStream(30);
    const track = stream.getVideoTracks()[0];
    if (!track) {
      throw new Error('Failed to create video track from canvas');
    }
    return track;
  } else {
    // Create an audio context and capture its stream
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const destination = audioContext.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    const track = destination.stream.getAudioTracks()[0];
    if (!track) {
      throw new Error('Failed to create audio track from AudioContext');
    }
    return track;
  }
}

/**
 * Creates a REAL MediaStream with audio and video tracks for testing.
 * 
 * This is necessary because the browser's RTCPeerConnection.addTrack()
 * validates that tracks are genuine MediaStreamTrack instances.
 * 
 * @param id - Optional custom ID for the stream (useful for SFU testing)
 */
export function createRealMediaStreamForTesting(id?: string): MediaStream {
  const videoTrack = createRealMediaStreamTrack('video');
  const audioTrack = createRealMediaStreamTrack('audio');
  const stream = new MediaStream([videoTrack, audioTrack]);

  if (id) {
    // Override the stream ID for testing purposes
    Object.defineProperty(stream, 'id', {
      value: id,
      writable: false,
      configurable: true,
    });
  }

  return stream;
}
