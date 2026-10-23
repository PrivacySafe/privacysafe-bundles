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

import type { ConnectionStatus } from '@video/common/types/peer.types';

/**
 * Maps each ConnectionStatus to the i18n key used to render it in the
 * "connecting" banner and in the not-active section of the participants panel.
 */
export const CONNECTION_STATUS_I18N_KEY: Record<ConnectionStatus, string> = {
  invited: 'call.text.participant_invited',
  initializing: 'call.text.participant_connecting',
  connecting: 'call.text.participant_connecting',
  'exchanging-keys': 'call.text.participant_securing',
  establishing: 'call.text.participant_establishing',
  connected: 'call.text.stream_about_to_start',
  reconnecting: 'call.text.participant_reconnecting',
  declined: 'call.text.participant_declined',
  'no-answer': 'call.text.participant_no_response',
  'not-reached': 'call.text.participant_not_reached',
  timeout: 'call.text.participant_no_response',
  failed: 'call.text.participant_failed',
  disconnected: 'call.text.participant_disconnected',
};

/** Statuses without media yet — must never overwrite an already-live tile. */
export const PRE_MEDIA_STATUSES: ReadonlySet<ConnectionStatus> = new Set([
  'invited',
  'initializing',
  'connecting',
  'exchanging-keys',
  // A late "could not be reached" report must not overwrite a peer who is by
  // then already in the call: the report is about one lost copy of 'start', and
  // a repeat of it may well have got through.
  'not-reached',
  'establishing',
]);

/** Statuses hidden from the connecting banner (terminal / handled elsewhere). */
export const BANNER_HIDDEN_STATUSES: ReadonlySet<ConnectionStatus> = new Set([
  'failed',
  'disconnected',
]);

/**
 * Statuses that are "still being waited for" — rolled up into a single summary
 * line ("Waiting for N more participant(s) to join…").
 *
 * Only 'invited' belongs here, and the reason is what the summary line says: it
 * counts the people the call is still waiting on. A peer who declined, one who
 * rang out unanswered and one the invitation never reached are all done being
 * waited for - counting them promised an arrival that is not coming (live run of
 * 2026-08-16: the participants panel said "is not responding" while the banner
 * kept claiming one more participant was on the way).
 */
export const WAITING_STATUSES: ReadonlySet<ConnectionStatus> = new Set([
  'invited',
]);

/**
 * Statuses whose answer is in - or will never come - and which therefore say
 * nothing about the call still forming: kept out of the banner entirely, both
 * out of its per-peer rows and out of the summary count.
 *
 * They are NOT dropped from `connectingPeers`: that list also feeds the
 * participants panel, which is exactly where "{user} is not responding" and
 * "{user} declined the call" belong. The banner is about the call coming
 * together; the panel is about where each participant stands.
 */
export const SETTLED_STATUSES: ReadonlySet<ConnectionStatus> = new Set([
  'declined',
  'no-answer',
  'timeout',
  'not-reached',
]);
