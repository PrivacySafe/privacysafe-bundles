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
 * Re-join notices — the pure decisions on both ends of them.
 *
 * A client that presses "Join Call" for a call it left sends the host a ~250 B
 * notice before its SDP offer, because that offer is 13-21 KB and, over the
 * ASMail path of 2026-08-13, took 50s to arrive — 50s in which nobody else in
 * the call had any sign that someone was coming back. The host turns the notice
 * into the 'participant-reconnecting' broadcast that every participant already
 * renders.
 *
 * Both rules below are decisions about a message that may arrive LATE, out of
 * order, or more than once — the state it describes can have moved on by the
 * time it lands. That is a race no live test can be made to lose reliably, so
 * the racing values are arguments here and the rules are tables (see
 * doc/07-build-test-run.md §5.2.1).
 */

/**
 * How long a "connecting…" put up by a re-join notice may stand unconfirmed.
 *
 * A notice is best-effort and says nothing about whether the offer that should
 * follow it ever arrives: the user may change their mind and close the window,
 * or the offer may die on the server. Without an expiry the status hangs on
 * every participant's screen for the rest of the call.
 *
 * 120s covers two of the client's offer attempts (OFFER_RETRY_DELAYS =
 * 45s/60s/60s in client-channel.ts), so a return that genuinely succeeds on a
 * repeat is not declared over while it is still working. It is not meant to
 * cover all three: past two minutes the honest thing to show is nothing.
 */
export const REJOIN_NOTICE_TTL_MS = 120_000;

export type RejoinNoticeAction = 'announce' | 'ignore-connected' | 'ignore-closed';

/**
 * What the host should do with a re-join notice it just received.
 *
 * - `ignore-closed`: the call is over on this side. Broadcasting now would put
 *   signals into closed channels.
 * - `ignore-connected`: this peer is already in the call — a copy of a notice
 *   whose offer has since arrived, which would otherwise flip a live
 *   participant back to "connecting…".
 * - `announce`: everything else, INCLUDING a notice for a peer whose return is
 *   already announced. Re-announcing is deliberate and is what makes the
 *   feature self-healing: the client repeats its notice (each copy stamped
 *   afresh, so it is not a duplicate), and a placeholder tile taken down in
 *   between — by a late 'participant-left' from the departure that preceded
 *   the return — comes back on the next one. Announcing is idempotent
 *   everywhere it lands: the receiving side creates a tile only where there is
 *   none (see participantTileOnRejoinNotice), and the expiry below is simply
 *   re-armed.
 */
export function rejoinNoticeAction(state: {
  /** The host channel has been closed (the call ended on this side). */
  callIsClosed: boolean;
  /** This client's connection reached 'connected' at some point. */
  isConnected: boolean;
}): RejoinNoticeAction {
  if (state.callIsClosed) {
    return 'ignore-closed';
  }
  if (state.isConnected) {
    return 'ignore-connected';
  }
  return 'announce';
}

export type RejoinNoticeExpiry = 'withdraw' | 'ignore';

/**
 * What the host does when a re-join notice's TTL runs out.
 *
 * `withdraw` broadcasts `reconnecting: false`, which is what takes the
 * placeholder tile off every screen. Everything else is a reason not to touch
 * it: the peer arrived after all, the call ended, or the announcement was
 * already withdrawn by the join path.
 */
export function rejoinNoticeExpiry(state: {
  callIsClosed: boolean;
  isConnected: boolean;
  /** The announcement is still standing (nothing has cancelled it). */
  stillAnnounced: boolean;
}): RejoinNoticeExpiry {
  if (state.callIsClosed || state.isConnected || !state.stillAnnounced) {
    return 'ignore';
  }
  return 'withdraw';
}

/** A participant's tile as far as this decision is concerned. */
export interface TileOnRejoinNotice {
  /** Whether the tile has media on it. */
  hasStream: boolean;
  /**
   * Whether this tile is a placeholder put up by a re-join notice and nothing
   * else — i.e. the receiver created it itself, out of a notice, for someone
   * who had no tile.
   */
  fromRejoinNotice: boolean;
}

export type RejoinTileAction = 'create-connecting' | 'remove' | 'leave-as-is';

/**
 * What a 'participant-reconnecting' does to the tile of the peer it names.
 *
 * The signal carries two cases, and they differ in how a MISSING tile is to be
 * read: a live participant's link blip (the tile is there, only its
 * `reconnecting` hint changes) and a departed participant on the way back
 * (there is no tile at all — 'participant-left' removed it — so one has to be
 * created, or the notice shows nothing).
 *
 * The `reconnecting: false` half is where the care goes, because on its own it
 * does NOT say which case it belongs to. The receiving side keeps the one fact
 * that settles it — whether the tile in question is a placeholder it created
 * out of a notice — and only such a placeholder, still without media, is taken
 * down. Two failures this avoids:
 *
 * - the host withdraws a re-join hint the moment the returning peer's
 *   connection reports ANY state, which is well before its tracks arrive.
 *   Removing on that would take a joining participant off the screen and put
 *   them back a beat later — a flicker on every successful return;
 * - a blip of a participant who happens to have no media (nothing guarantees
 *   one) would otherwise remove a live participant's tile outright.
 */
export function participantTileOnRejoinNotice(
  existing: TileOnRejoinNotice | undefined, reconnecting: boolean,
): RejoinTileAction {
  if (reconnecting) {
    return existing ? 'leave-as-is' : 'create-connecting';
  }
  if (!existing || existing.hasStream || !existing.fromRejoinNotice) {
    return 'leave-as-is';
  }
  return 'remove';
}

/** Which of the signal's two meanings a 'participant-reconnecting' carries. */
export type ReconnectingHintKind = 'rejoin' | 'link-blip';

export interface ReconnectingHintEffect {
  /**
   * Whether to write the store's `reconnecting` flag for this participant -
   * i.e. whether to put the blur overlay on their tile.
   */
  setsReconnectingFlag: boolean;
  tile: RejoinTileAction;
}

/**
 * Everything a 'participant-reconnecting' does on the receiving side.
 *
 * The signal has always carried two meanings, and until the run of 2026-08-16
 * the receiver told them apart by GUESSING: the flag was withheld only where
 * the tile in question was a placeholder this window had created out of a
 * notice. The guess was wrong in both cases the run produced, and each time the
 * result was a live participant's video sitting under a blur that said
 * "reconnecting" with nothing left to take it off:
 *
 * - a tile is there for everyone from the start - seedExpectedParticipants
 *   gives every member of the chat one before any signalling - so a peer that
 *   joins mid-call is never a placeholder, and the announcement of its arrival
 *   was read as a link blip;
 * - a re-join notice is repeated (0/10/30 s), and the later copies land after
 *   the media has arrived and the placeholder record has been dropped - so even
 *   a genuine placeholder stops being one halfway through its own announcement.
 *
 * Hence `kind` on the wire (ParticipantReconnectingInfo) and this table. The
 * central rule: a 'rejoin' NEVER blurs. A return is announced with the peer's
 * tracks still in flight, and nothing withdraws that announcement on success -
 * the host forgets a fulfilled one deliberately, without broadcasting
 * `reconnecting: false`, because a withdrawal would take the placeholder down a
 * moment before the tracks land (see clearRejoinNotice in host-channel.ts).
 *
 * `undefined` is a peer on a build that predates the field: the old guess is
 * kept for it, being better than either constant answer.
 */
export function reconnectingHintEffect({ kind, reconnecting, existing }: {
  kind: ReconnectingHintKind | undefined;
  reconnecting: boolean;
  existing: TileOnRejoinNotice | undefined;
}): ReconnectingHintEffect {
  if (kind === 'rejoin') {
    return {
      setsReconnectingFlag: false,
      tile: participantTileOnRejoinNotice(existing, reconnecting),
    };
  }
  if (kind === 'link-blip') {
    return {
      setsReconnectingFlag: true,
      // Never 'remove': a blip says something about a LIVE participant's link,
      // and the tile it names is not this window's to take down. Removing on
      // one would drop the placeholder of somebody else's announced return that
      // happens to be standing at that moment.
      tile: (!existing && reconnecting) ? 'create-connecting' : 'leave-as-is',
    };
  }
  return {
    setsReconnectingFlag: !existing?.fromRejoinNotice,
    tile: participantTileOnRejoinNotice(existing, reconnecting),
  };
}
