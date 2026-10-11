/*
  Copyright (C) 2026 3NSoft Inc.

  This program is free software: you can redistribute it and/or modify it under
  the terms of the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful, but
  WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
  See the GNU General Public License for more details.

  You should have received a copy of the GNU General Public License along with
  this program. If not, see <http://www.gnu.org/licenses/>.
*/

/**
 * Video Call Constants — shared between Deno backend and Vue frontend.
 *
 * This module is the SINGLE SOURCE OF TRUTH for video call constants.
 * Both `src-deno/services/video-chat-service/constants.ts` and
 * `src-video/common/services/star-constants.ts` re-export from here to
 * avoid the dangerous desynchronization that previously existed (Deno had
 * MAX_CALL_PARTICIPANTS=10 while the frontend had =8).
 */

/**
 * Maximum number of participants in a single video call.
 * Includes the Host and all Clients.
 *
 * For decentralized client-side SFU, this is a balance between:
 * - Security (no central server bottleneck)
 * - Stability (predictable bandwidth requirements)
 * - Usability (sufficient for most group calls)
 */
export const MAX_CALL_PARTICIPANTS = 8;

/**
 * Video quality configuration returned by getVideoQualityConfig().
 */
export interface VideoQualityConfig {
  resolution: { width: number; height: number };
  bitrate: number; // bits per second
  framerate: number;
}

/**
 * Returns video quality parameters based on the total number of participants.
 *
 * Quality tiers:
 * - 2 participants (1-on-1): 720p, 1.5 Mbps, 24 FPS
 * - 3–4 participants: 480p, 500 Kbps, 24 FPS
 * - 5–7 participants: 360p, 300 Kbps, 20 FPS
 * - 8+ participants: 240p, 200 Kbps, 15 FPS
 */
export function getVideoQualityConfig(participantCount: number): VideoQualityConfig {
  if (participantCount <= 2) {
    return {
      resolution: { width: 1280, height: 720 },
      bitrate: 1_500_000, // 1.5 Mbps
      framerate: 24,
    };
  }
  if (participantCount <= 4) {
    return {
      resolution: { width: 640, height: 480 },
      bitrate: 500_000, // 500 Kbps
      framerate: 24,
    };
  }
  if (participantCount <= 7) {
    return {
      resolution: { width: 480, height: 360 },
      bitrate: 300_000, // 300 Kbps
      framerate: 20,
    };
  }
  return {
    resolution: { width: 426, height: 240 },
    bitrate: 200_000, // 200 Kbps
    framerate: 15,
  };
}

/**
 * Quality profile for screen-share senders. Screen content is 'detail', not
 * motion: it needs the bitrate for a legible native-resolution picture and
 * tolerates a low frame rate. The camera profiles above (500 Kbps at 3-4
 * participants) starve a 1440p window capture into a black-then-frozen tile,
 * so screen senders are capped by this profile instead - see
 * applyVideoBitrateLimit(), which picks it by the track's contentHint.
 */
export const SCREEN_SHARE_QUALITY: VideoQualityConfig = {
  resolution: { width: 2560, height: 1440 },
  bitrate: 2_500_000, // 2.5 Mbps
  framerate: 15,
};

/**
 * Simulcast encoding layers for selective forwarding (true-SFU).
 *
 * Three layers:
 * - high: 720p 1.5Mbps (used for 1-on-1 or when bandwidth allows)
 * - medium: 480p 500Kbps (default for 3-4 participants)
 * - low: 360p 150Kbps (fallback for poor connections or 5+ participants)
 *
 * Each client sends all three layers; the Host selectively forwards
 * the appropriate layer to each receiving client without re-encoding,
 * by toggling `active` on received RTCRtpEncodingParameters.
 */
export const SIMULCAST_ENCODINGS: RTCRtpEncodingParameters[] = [
  {
    rid: 'high',
    maxBitrate: 1_500_000,
    scaleResolutionDownBy: 1,
    maxFramerate: 24,
  },
  {
    rid: 'medium',
    maxBitrate: 500_000,
    scaleResolutionDownBy: 1.5,
    maxFramerate: 24,
  },
  {
    rid: 'low',
    maxBitrate: 150_000,
    scaleResolutionDownBy: 2.5,
    maxFramerate: 15,
  },
];

/**
 * Returns the active simulcast layer index for a given participant count.
 * Host uses this to select which layer to forward to each client.
 */
export function getSimulcastLayerFor(
  participantCount: number,
  bandwidthHint?: number,
): number {
  // Bandwidth-based override (from quality monitoring)
  if (bandwidthHint !== undefined) {
    if (bandwidthHint < 200_000) return 2; // low
    if (bandwidthHint < 800_000) return 1; // medium
    return 0; // high
  }
  // Participant-count-based default
  if (participantCount <= 2) return 0; // high
  if (participantCount <= 4) return 1; // medium
  return 2; // low
}

/**
 * Builds media constraints for getUserMedia based on participant count.
 */
export function buildMediaConstraints(participantCount: number): MediaStreamConstraints {
  const quality = getVideoQualityConfig(participantCount);
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: {
      width: { ideal: quality.resolution.width },
      height: { ideal: quality.resolution.height },
      frameRate: { ideal: quality.framerate },
    },
  };
}

// The STUN/TURN configuration used to live here, in a constant with the TURN
// credentials in it - and this file goes into the window bundles. It is now data
// read by the background instance and handed to a window in `ChatInfoForCall`
// when a call starts: src-deno/services/video-chat-service/ice-config.ts.
