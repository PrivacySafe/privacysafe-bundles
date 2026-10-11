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

import type { SerializedDeliveryError } from '../../types/chat.types.ts';

const KNOWN_FLAGS = [
  'domainNotFound', 'noServiceRecord', 'unknownRecipient', 'senderNotAllowed',
  'inboxIsFull', 'badRedirect', 'authFailedOnDelivery', 'msgTooBig', 'allowedSize',
  'recipientHasNoPubKey', 'recipientPubKeyFailsValidation', 'msgNotFound', 'msgCancelled',
] as const;

/**
 * Converts a delivery error (a core DeliveryException/RuntimeException plain
 * object, or a bare Error instance) into a plain, JSON-serializable shape.
 * Native Error instances lose `message`/`stack` under JSON.stringify because
 * those properties aren't own-enumerable - this normalizes them upfront so
 * `history.changes[].value` survives the SQLite round trip.
 */
export function serializeDeliveryError(err: unknown): SerializedDeliveryError {
  if (err instanceof Error) {
    return { message: err.message || err.name || 'Unknown error', type: err.name };
  }
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const out: SerializedDeliveryError = {
      message: (typeof e.message === 'string' && e.message) ? e.message : 'Unknown error',
    };
    if (typeof e.type === 'string') {
      out.type = e.type;
    }
    for (const flag of KNOWN_FLAGS) {
      if (e[flag] !== undefined) {
        (out as unknown as Record<string, unknown>)[flag] = e[flag];
      }
    }
    return out;
  }
  return { message: String(err) };
}
