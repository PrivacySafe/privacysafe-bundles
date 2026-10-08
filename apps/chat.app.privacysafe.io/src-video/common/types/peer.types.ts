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
 * Peer types — Star (Host-Client) architecture types.
 * 
 * Previous Mesh-specific types (PeerState with PeerChannelWithStreams) have been removed.
 * 
 * Host/Client state types are defined in star.types.ts:
 * - HostWebRTCChannel: manages multiple client connections
 * - ClientWebRTCChannel: single connection to host
 */

export type VideoShareStreamType = 'window' | 'screen';
export type SoundShareStreamType = 'desk-sound';
export type StreamType = 'camera+mic' | VideoShareStreamType | SoundShareStreamType;

export interface StreamWithInfo {
  type: StreamType;
  stream: MediaStream;
  tracks: string[];
}

// Connection status types (may be reused in Star architecture)
export type ConnectionStatus =
  | 'invited'
  | 'initializing'
  | 'connecting'
  | 'exchanging-keys'
  | 'establishing'
  | 'connected'
  | 'reconnecting'
  | 'failed'
  | 'timeout'
  | 'no-answer'
  | 'declined'
  /**
   * The invitation itself never got to this peer: the platform reported the
   * delivery of 'start' as failed and the resends were spent. Distinct from
   * 'no-answer', which says the invitation arrived and went unanswered - the two
   * used to be indistinguishable in the UI, which is why a group call with every
   * invitation lost on the server looked like three people ignoring it.
   */
  | 'not-reached'
  | 'disconnected';

export interface ConnectionInfo {
  status: ConnectionStatus;
  lastUpdated: number;
  errorMessage?: string;
  retryCount?: number;
}

// Note: Star architecture types (HostWebRTCChannel, ClientWebRTCChannel, etc.)
// are defined in star.types.ts and used via @video/common/types/star.types
