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
 * Reserved relay slots — the pure decisions.
 *
 * A slot is an m-line a client offers as `recvonly` and the host answers as
 * `sendonly` while it still has nothing to send. Later the host drops a
 * participant's track into it with replaceTrack, which needs NO renegotiation.
 *
 * Why the call needs this: renegotiating on every join is what killed the group
 * call of 2026-08-12. Over a 7-15s ASMail hop the host's relay offer reached a
 * joiner whose own first negotiation was still in flight; the polite client
 * rolled its offer back, and a transport that had already reached ICE-connected
 * went back to 'new' and never recovered. With slots the join path sends no offer
 * at all — only a mapping message.
 *
 * Everything here is a pure function of plain data, so the reservation maths and
 * the assignment policy are testable without an RTCPeerConnection.
 */

import { areAddressesEqual } from '@shared/address-utils';
import type { RelaySlotDeclaration } from '@video/common/types/star.types';
import { MAX_CALL_PARTICIPANTS } from './star-constants';

/** What a client intends an m-line for; the host honours it when it can. */
export interface SlotSpec {
  kind: 'audio' | 'video';
  purpose: 'va' | 'screen';
  forAddr?: string;
}

/**
 * Hard ceiling on reserved m-lines, whatever the roster says.
 *
 * Set from a measurement, not a guess (Suite 15, "keeps an offer carrying the
 * full slot reserve out of ASMail's danger zone"): with codec preferences
 * applied as the client applies them, a client offer is ~7KB before any slot and
 * each slot adds ~1.4KB. The ASMail load tests only ever exercised SDP up to
 * 14KB and call 8-14KB the danger zone, so the reserve gets a budget of about
 * 7KB — four slots — and the roster beyond that is relayed the old way:
 * renegotiated, slower, but bounded.
 *
 * Four covers a three-party call outright (one other participant's audio and
 * video, plus the screen reserve) — which is the call that fell over on
 * 2026-08-12 — and covers both other participants of a four-party one, with the
 * screen share falling back.
 */
export const MAX_RESERVED_SLOTS = 4;

/** Video slots reserved for screen shares, shared by the whole call. */
export const RESERVED_SCREEN_VIDEO_SLOTS = 1;
/** Audio slots for the desktop sound of a shared screen. */
export const RESERVED_SCREEN_AUDIO_SLOTS = 1;

/**
 * Which slots a client should reserve in its offer.
 *
 * One audio + one video per OTHER participant of the roster (the host relays each
 * of them), plus a small screen-share reserve for the call as a whole. Ordered
 * so that the per-participant slots come first: if the cap truncates anything, it
 * truncates the speculative screen reserve rather than a participant's voice.
 *
 * One-to-one calls get nothing: there is no relay there, and an empty result
 * keeps their SDP byte-for-byte as it was.
 */
export function buildSlotReservation(params: {
  ownAddr: string;
  hostAddr: string;
  /** Everyone the call expects, as known from ChatInfoForCall.peers. */
  rosterAddrs: string[];
  isGroupCall: boolean;
}): SlotSpec[] {
  const { ownAddr, hostAddr, rosterAddrs, isGroupCall } = params;
  if (!isGroupCall) {
    return [];
  }
  const others: string[] = [];
  for (const addr of rosterAddrs) {
    if (!addr || areAddressesEqual(addr, ownAddr) || areAddressesEqual(addr, hostAddr)) {
      continue;
    }
    if (!others.some(seen => areAddressesEqual(seen, addr))) {
      others.push(addr);
    }
  }
  if (others.length === 0) {
    return [];
  }
  // The host itself sends its own media on its own m-lines, so the roster minus
  // us and the host is exactly the set the host has to relay.
  const capped = others.slice(0, MAX_CALL_PARTICIPANTS - 2);
  const specs: SlotSpec[] = [];
  for (const addr of capped) {
    specs.push({ kind: 'audio', purpose: 'va', forAddr: addr });
    specs.push({ kind: 'video', purpose: 'va', forAddr: addr });
  }
  for (let i = 0; i < RESERVED_SCREEN_VIDEO_SLOTS; i += 1) {
    specs.push({ kind: 'video', purpose: 'screen' });
  }
  for (let i = 0; i < RESERVED_SCREEN_AUDIO_SLOTS; i += 1) {
    specs.push({ kind: 'audio', purpose: 'screen' });
  }
  return specs.slice(0, MAX_RESERVED_SLOTS);
}

/** A slot as the host tracks it: the declaration plus who is in it. */
export interface SlotState<T> {
  declaration: RelaySlotDeclaration;
  /** Sender key currently relayed here (address, or 'screen:...'), or null. */
  owner: string | null;
  /** Whatever the caller needs to act on the slot (a transceiver, in practice). */
  handle: T;
}

/**
 * Picks the slot to relay `ownerKey`'s track of `kind` in.
 *
 * Preference order, and each step has a reason:
 *  1. the slot already relaying this owner — a re-join must land on the same
 *     m-line, otherwise the viewer sees a second tile for the same person;
 *  2. a free slot the client reserved FOR this owner — then the client already
 *     knows whose media it is and can show it as soon as it unmutes, without
 *     waiting 7-15s for the mapping;
 *  3. any free slot of the right purpose;
 *  4. for a screen share, a free 'va' slot — a screen is worth more than a
 *     reserve held for a participant who has not joined.
 */
export function pickSlot<S extends SlotState<unknown>>(
  slots: S[],
  want: { kind: 'audio' | 'video'; purpose: 'va' | 'screen'; ownerKey: string },
): S | undefined {
  const ofKind = slots.filter(slot => slot.declaration.kind === want.kind);
  const mine = ofKind.find(slot => !!slot.owner && (slot.owner === want.ownerKey));
  if (mine) {
    return mine;
  }
  const free = ofKind.filter(slot => !slot.owner);
  const reservedForOwner = free.find(slot =>
    (slot.declaration.purpose === want.purpose)
    && !!slot.declaration.forAddr
    && areAddressesEqual(slot.declaration.forAddr, want.ownerKey));
  if (reservedForOwner) {
    return reservedForOwner;
  }
  const samePurpose = free.find(slot => slot.declaration.purpose === want.purpose);
  if (samePurpose) {
    return samePurpose;
  }
  return (want.purpose === 'screen')
    ? free.find(slot => slot.declaration.purpose === 'va')
    : undefined;
}

/**
 * What the VIEWER of a relay slot knows about who is in it right now.
 *
 * The client's side of a slot, as opposed to SlotState above, which is the
 * host's. Kept here, pure, because the rule below is a race that cannot be
 * exercised reliably any other way: its trigger is the LAG between RTP stopping
 * and the receiver's track going `muted` (Chromium's own timeout, seconds), so a
 * live or integration test reproduces the bug only by luck. Taking `hasMedia` as
 * an argument turns that race into a table.
 */
export interface SlotViewerState {
  /** Owner the host named in a stream mapping for this m-line, if any. */
  mappedOwner: string | null;
  /** Whether real RTP has been seen on this slot (an 'unmute' fired). */
  hasMedia: boolean;
  /** Who the slot was reserved for at negotiation - a hint, not a fact. */
  forAddr?: string;
}

/**
 * Whose media a slot may be shown as, or `undefined` for "do not show it".
 *
 * Two sources of an owner, and they are NOT equal in strength:
 *
 * - a mapping from the host (`mappedOwner`) is proof in itself - the host only
 *   sends one once it has actually put a track into the slot;
 * - the client's own reservation hint (`forAddr`) needs `hasMedia` to back it up.
 *   Without that condition every not-yet-joined participant of the roster would
 *   get a tile, hiding the connecting banner behind tiles that never fill.
 */
export function relaySlotOwnerToShow(slot: SlotViewerState): string | undefined {
  return slot.mappedOwner ?? (slot.hasMedia ? slot.forAddr : undefined);
}

/**
 * What to write onto a slot when the host says its occupant left.
 *
 * `hasMedia: false` unconditionally, and that is the whole point of naming this
 * rule: 'participant-left' is the host stating the slot is empty, whereas the
 * receiver's track only goes `muted` seconds later. Code that re-read the track
 * instead therefore stored `true` for a slot that had just been emptied, and the
 * next review of the slots - ANY renegotiation, a screen share above all - then
 * read `hasMedia && forAddr` as a live participant and put a tile up for someone
 * who had left, announcing that their camera was about to start (group call of
 * 2026-08-13, a-2600's tile for the departed a-3600).
 *
 * Nothing is lost by clearing it: a returning participant is announced by a
 * mapping, which relaySlotOwnerToShow honours regardless of this flag, and the
 * slot's 'unmute' listener sets it back to true when RTP actually resumes.
 *
 * `emittedFor` goes too, or the slot would refuse to emit again when the same
 * participant re-joins into the same m-line (`emittedFor === owner` reads as
 * "already shown"), and their tile would never come back. The host reuses that
 * very slot for a re-join on purpose (`forAddr`).
 */
export function clearedRelaySlotOnDeparture(): {
  mappedOwner: null;
  emittedFor: null;
  hasMedia: false;
} {
  return { mappedOwner: null, emittedFor: null, hasMedia: false };
}

/**
 * A relaying sender, as the decision below needs to see it.
 *
 * Deliberately not `RTCRtpSender`: the rule is about what is being forwarded,
 * and stating it over plain data is what makes it testable without a
 * PeerConnection — the same reason everything else in this file is a pure
 * function.
 */
export interface RelayingSenderView {
  track: { kind: string; readyState: string } | null;
}

/**
 * Which kinds of a source's media are ALREADY on their way to a client.
 *
 * The join path used to ask a coarser question — "is this source forwarded at
 * all?" — and skip the source whole when the answer was yes (`handleClientOffer`,
 * the `outgoingTrackSenders.has(sourceAddr)` guard). One sender was enough to
 * satisfy it, and the join path is the ONLY route by which an already-present
 * participant's media ever reaches a newcomer: whatever it skipped there was
 * skipped for the life of that connection. A client that had somehow been given
 * only the video of a participant never got their voice — the group call of
 * 2026-08-19, where the last participant to join heard nobody but the host while
 * seeing everyone.
 *
 * That "somehow" is not hypothetical. Between the newcomer's ClientConnection
 * being registered and the join path reaching this decision there are five
 * awaits (setRemoteDescription, candidate flush, createAnswer,
 * setLocalDescription, silencing the slots), and any `ontrack` firing in that
 * window goes through addTrackToClients — which already sees the new client and
 * writes one sender for it. A dead track counts for nothing here for the same
 * reason: a sender holding an `ended` track forwards silence, and reading it as
 * "already covered" is the same mistake one level down.
 */
export function kindsAlreadyForwarded(senders: RelayingSenderView[]): Set<string> {
  const kinds = new Set<string>();
  for (const { track } of senders) {
    if (track && (track.readyState === 'live')) {
      kinds.add(track.kind);
    }
  }
  return kinds;
}

/**
 * Key a stream mapping is deduplicated and batched under.
 *
 * Slots must key by mid: their stream id is fixed at negotiation, so several
 * slots can legitimately share one (or have none), and keying by stream id made
 * them overwrite each other inside one batch.
 */
export function streamInfoKey(info: { mid?: string; streamId: string }): string {
  return info.mid ? `mid:${info.mid}` : `stream:${info.streamId}`;
}
