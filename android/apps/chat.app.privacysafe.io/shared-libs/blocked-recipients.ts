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
 * A hook that keeps blocked addresses out of every outgoing delivery.
 *
 * It is a hook for the same reason setDbFlush is one (see dataset/db-flush.ts):
 * the sending layer is a set of plain exported functions with no factory to
 * inject a dependency into, and the tracker that knows the blacklist lives
 * elsewhere entirely.
 *
 * Why here and not where the recipients are computed: that happens in some
 * twenty places - recipientsInChat covers a third of them, and the rest read
 * `Object.keys(chat.members)` for themselves, in renaming, membership changes,
 * invitations, reactions, edits and calls. Filtering in each is filtering in
 * all but one of them, eventually. Every send, on the other hand, passes
 * through one of three calls to `w3n.mail.delivery.addMsg`, and all three go
 * through this.
 *
 * A one-to-one chat with a blocked peer is already readonly in the GUI, but
 * readonly does not cover what the app sends on its own - read receipts,
 * reactions, deletions. Those stop here too.
 *
 * It lives in shared-libs rather than in the sending service because the third
 * of those three calls is in webrtc-signalling.ts, which the call window uses
 * as well - and the window cannot reach into the deno component's modules.
 * Only the deno component registers a filter: it is the one holding the
 * blacklist. In the call window this stays identity, which costs nothing real -
 * the window only ever signals inside a call that is already established, and a
 * call with a blocked peer does not get that far, its start being dropped both
 * on the way out and on the way in.
 */

let filterFn: ((recipients: string[]) => string[]) | undefined = undefined;

/**
 * Registered at start-up, once the blacklist tracker exists.
 */
export function setBlockedRecipientsFilter(fn: (recipients: string[]) => string[]): void {
  filterFn = fn;
}

/**
 * The addresses of `recipients` that may still be written to. Identity before
 * the filter is registered, and identity is also the safe answer: a message
 * sent to somebody who should have been dropped is a smaller failure than the
 * whole sending layer going quiet because start-up order changed.
 */
export function withoutBlockedRecipients(recipients: string[]): string[] {
  if (!filterFn) {
    return recipients;
  }
  try {
    return filterFn(recipients);
  } catch (err) {
    w3n.log('error', `Blocked recipients filter failed`, err);
    return recipients;
  }
}
