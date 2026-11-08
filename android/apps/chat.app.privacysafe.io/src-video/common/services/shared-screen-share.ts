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
 * Shared Screen Share Helpers
 *
 * Extracts the common screen-share address construction and proxy-stream
 * creation logic that was duplicated between:
 * - client: addScreenTrack() / removeScreenTrack() in client-channel.ts
 * - host: addOwnScreenTrack() / removeOwnScreenTrack() / broadcastScreenTrackToOtherClients()
 *   in host-channel.ts
 *
 * Screen share addresses use the format: `screen:${mailerId}:${srcId}`
 * This allows clients to identify screen share streams separately from
 * regular VA (camera/mic) streams.
 */

import { sameAddress } from '@shared/address-utils';

/**
 * Builds a screen share address from a mailer ID and source ID.
 *
 * Format: `screen:${mailerId}:${srcId}`
 *
 * This address is used as:
 * - The sender address in stream-sender-info signals
 * - The key in outgoingTrackSenders maps (host side)
 * - The participant address in the streams store
 *
 * @param mailerId - The mailer ID of the screen share owner
 * @param srcId - The source ID of the screen share (unique per share session)
 */
export function buildScreenAddr(mailerId: string, srcId: string): string {
  return `screen:${mailerId}:${srcId}`;
}

/**
 * Checks whether an address refers to a screen share participant.
 *
 * @param addr - The address to check
 * @returns true if the address starts with 'screen:'
 */
export function isScreenShareAddr(addr: string): boolean {
  return addr.startsWith('screen:');
}

/**
 * Extracts the source ID from a screen share address.
 *
 * Format: `screen:${mailerId}:${srcId}` → returns `srcId`
 * If the address has fewer parts, returns 'unknown'.
 *
 * @param screenAddr - The screen share address (must start with 'screen:')
 */
export function extractSrcIdFromScreenAddr(screenAddr: string): string {
  const parts = screenAddr.split(':');
  return parts.length >= 3 ? parts.slice(2).join(':') : 'unknown';
}

/**
 * Extracts the mailer ID (owner address) from a screen share address.
 *
 * Format: `screen:${mailerId}:${srcId}` → returns `mailerId`
 *
 * @param screenAddr - The screen share address (must start with 'screen:')
 */
export function extractMailerIdFromScreenAddr(screenAddr: string): string {
  const parts = screenAddr.split(':');
  return parts.length >= 2 ? parts[1] : '';
}

/**
 * May a signal that arrived on `channelAddr`'s channel name `actorAddr`?
 *
 * A participant speaks for itself and for its own `screen:<its addr>:<srcId>`
 * pseudo-participants - those are the only two actors it ever names (see
 * addScreenTrack / removeScreenTrack in client-channel, which are what put a
 * screen address into a `stream-sender-info` or a `participant-left`). Anything
 * else is a claim about a participant the sender has no standing to make.
 *
 * The address of a screen share carries its owner, which is what makes this
 * decidable at all: `screen:${mailerId}:${srcId}`.
 *
 * Written after a report (2026-09-09) about `fromAddr` being taken on trust:
 * fixing that field alone would have left these payload-borne addresses, where
 * a participant could still hand the host somebody else's name - claiming
 * another participant's video stream, or announcing their departure.
 */
export function mayActFor(channelAddr: string, actorAddr: unknown): boolean {
  if (!actorAddr || (typeof actorAddr !== 'string')) {
    return false;
  }
  const claimedOwner = isScreenShareAddr(actorAddr)
    ? extractMailerIdFromScreenAddr(actorAddr)
    : actorAddr;
  return sameAddress(claimedOwner, channelAddr);
}

/**
 * Creates a proxy MediaStream containing a single track for screen share.
 *
 * A plain `new MediaStream([track])` is used so the native stream.id (UUID)
 * matches what the receiving peer sees in ontrack. The stream-sender-info
 * signal then maps that UUID to the screen share address.
 *
 * This is used by both:
 * - Client: addScreenTrack() creates a proxy stream for its own screen share
 * - Host: addOwnScreenTrack() and broadcastScreenTrackToOtherClients() create
 *   a proxy stream per screen share (NOT the shared relay stream used for VA)
 *
 * @param track - The screen share track (video or audio)
 */
export function createProxyStreamForScreen(track: MediaStreamTrack): MediaStream {
  return new MediaStream([track]);
}
