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
import type { AttachmentInfo } from '../../src/common/types/mail.types.ts';

export type AttachmentAvailability =
  /** The bytes are in this device's file store, or in a file it can still read. */
  | 'local'
  /** The bytes are in an incoming message in the shared inbox - readable on any device. */
  | 'in-incoming-msg'
  /** Attached on another device of the user; the record travelled here, the bytes did not. */
  | 'on-another-device'
  /** Nothing to read it from at all. */
  | 'missing';

/**
 * The one place where an attachment's availability is decided.
 *
 * Visible from both src-deno and src: `shared/` is common to them, under the
 * `@shared` alias.
 *
 * The order of the checks is the content of this function. `hasNoLocalSource`
 * goes first because a record from another device may carry `type: 'origin'` and
 * `originMsgId` as well - and then the answer is still "on another device",
 * except in case 1 of attachmentsForPhantom(), where the bytes really are in the
 * shared inbox and `hasNoLocalSource` is deliberately not set.
 */
export function attachmentAvailabilityOf(
  a: Pick<AttachmentInfo, 'id' | 'type' | 'originMsgId' | 'hasNoLocalSource'>,
  incomingMsgId?: string,
): AttachmentAvailability {
  if (a.hasNoLocalSource) {
    return 'on-another-device';
  }
  if (incomingMsgId || ((a.type === 'origin') && a.originMsgId)) {
    return 'in-incoming-msg';
  }
  return a.id ? 'local' : 'missing';
}
