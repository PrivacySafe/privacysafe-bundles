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
 * How a chat history record of a cancelled call reads, and which way its arrow
 * points.
 *
 * Its own module, and a pure one, because the question it answers used to be
 * answered by a field that stopped carrying the answer. The record used to be
 * saved with `isIncomingMsg: true` when it came from a peer's system message, so
 * the renderer branched on that; then the record was made to synchronize between
 * a user's devices, and both the local copy and the one written from a phantom
 * became `isIncomingMsg: false` (deliberately - the two copies must not differ).
 * The branch went dead in silence, and every cancellation, ours or theirs,
 * started reading "The incoming call from X was cancelled" - including the call
 * we placed ourselves and the peer declined (live run of 2026-08-16).
 *
 * What decides the wording is who hosted the call, and that is inside the
 * record: `callSessionId` begins with the host's address. Records made before
 * that field existed carry none, and those fall back on what the subtype alone
 * can say.
 */

import { areAddressesEqual } from './address-utils.ts';
import { hostAddrOfCallSession } from './chat-ids.ts';

export type CallCancelSubType =
  | 'outgoing-call-cancelled' | 'incoming-call-cancelled' | 'call-collision-failed';

export interface CallCancelWording {
  /** i18n key of the line shown in the chat history. Never an empty string. */
  i18nKey: string;
  /**
   * Whether the call this record is about came to us. Drives the arrow icon,
   * which until now pointed "outgoing" at every cancellation, half of which were
   * about calls somebody placed to us.
   */
  wasIncomingCall: boolean;
}

/**
 * @param subType which event the record is about: 'outgoing-call-cancelled' -
 * the caller withdrew the call before it was answered; 'incoming-call-cancelled'
 * - somebody declined a ringing call; 'call-collision-failed' - two calls started
 * in the chat at the same moment never met.
 * @param callSessionId of the call the record is about; its host is the caller.
 * Undefined for records made by builds that predate the field.
 * @param ownAddr this user's address.
 * @param isGroupChat separates "the (only) other side declined" from "one of the
 * invited declined", which are different statements about the call.
 */
export function callCancelWording(
  subType: CallCancelSubType,
  callSessionId: string | undefined,
  ownAddr: string | undefined,
  isGroupChat: boolean,
): CallCancelWording {
  if (subType === 'call-collision-failed') {
    // Two calls started at the same moment that never met: neither went
    // anywhere, so there is no direction to show - the arrow is ours, as the
    // user did place a call.
    return { i18nKey: 'va.text.call_collision_failed', wasIncomingCall: false };
  }

  const hostAddr = hostAddrOfCallSession(callSessionId);
  // "Unknown" is not "theirs": without a session id nothing here knows who
  // called, so the answer has to come from the subtype alone (see below).
  const weHosted = !!hostAddr && !!ownAddr && areAddressesEqual(hostAddr, ownAddr);

  if (subType === 'outgoing-call-cancelled') {
    // The caller hung up before anyone answered. This record is written by the
    // side that was ringing, so in practice the caller is the peer; a session
    // naming us as host is a record of our own withdrawn call, and says so.
    return weHosted
      ? { i18nKey: 'va.text.outgoing_call_cancelled', wasIncomingCall: false }
      : { i18nKey: 'va.text.missed_incoming_call', wasIncomingCall: true };
  }

  if (!weHosted) {
    // Somebody declined a call that was coming to us - either us on this device,
    // or another device of ours whose record reached this one.
    return { i18nKey: 'va.text.incoming_call_cancelled', wasIncomingCall: true };
  }

  // Our own call, declined by an invitee. In a group that is one of several
  // people saying no, and the call may well have gone on without them; in a
  // one-to-one chat it is the call itself being refused.
  return {
    i18nKey: isGroupChat
      ? 'va.text.incoming_call_not_accepted'
      : 'va.text.outgoing_call_cancelled_by',
    wasIncomingCall: false,
  };
}
