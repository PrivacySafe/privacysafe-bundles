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
 * The one place an inbox message is decided about.
 *
 * The `msgType === 'mail'` filter used to live in two - in the subscription and
 * inside catchUpIncomingMail - and with phantoms in the picture the
 * deduplication and the watermark would have had to live in two places as well,
 * and would have drifted.
 */

import type { IncomingMessage } from '../../../src/common/types/mail.types.ts';
import { makeLogger } from '../../../shared/utils/logger.ts';
import { sameAddress } from '../../../shared/utils/address-utils.ts';
import { MAIL_SYNC_MSG_TYPE } from '../../types/mail-sync.types.ts';

const log = makeLogger('InboxRouter');

export interface IncomingRouterCtx {
  /** Stores an ordinary mail message. */
  persistMail(msg: IncomingMessage, opts?: { notify?: boolean }): Promise<void>;
  /** Handles a message of the synchronization type. */
  handleSync(msg: web3n.asmail.IncomingMessage): Promise<boolean>;
  /** Whether the user is to be notified of a new message. */
  notify: boolean;
  /** This user's own address. Mail to oneself is never dropped. */
  ownAddr: string;
  /** Whether the user has blocked this sender. */
  isBlockedSender(address: string): boolean;
  /** Whether this message is already in the database, from before a blocking. */
  isAlreadyStored(msgId: string): boolean;
  /** Takes a message off the server. Only ever called for a blocked sender. */
  dropFromInbox(msgId: string): Promise<void>;
}

/**
 * Whether this message is one the user has chosen not to receive.
 *
 * Asked ONLY inside the 'mail' branch below. A synchronization phantom comes
 * from this very user's address, and must never be put to this question - the
 * own-address check here is a second line for a future caller, not the first.
 *
 * Mail that is already in the database was received BEFORE the blocking, and
 * only the user deletes that. The check is not theoretical: a restore rewinds
 * the watermark to 0 and asks for a pass over the whole inbox, so the scan does
 * come back round to mail from years ago.
 */
function isFromBlockedSender(
  msg: web3n.asmail.IncomingMessage,
  ctx: IncomingRouterCtx,
): boolean {
  const { sender } = msg;
  return (
    !!sender
    && !sameAddress(sender, ctx.ownAddr)
    && ctx.isBlockedSender(sender)
    && !ctx.isAlreadyStored(msg.msgId)
  );
}

/**
 * @returns true when the message was handled, i.e. its deliveryTS may be
 *          counted into the watermark. A message of a type this app has no
 *          business with counts as handled too: it is not going to become
 *          handleable later, and holding the watermark for it would make every
 *          start re-list the inbox from the same point.
 */
export async function routeIncomingMsg(
  msg: web3n.asmail.IncomingMessage,
  ctx: IncomingRouterCtx,
): Promise<boolean> {
  if (msg.msgType === 'mail') {
    if (isFromBlockedSender(msg, ctx)) {
      log.info(`Dropping incoming ${msg.msgId}: its sender is blocked.`);
      await ctx.dropFromInbox(msg.msgId);
      // HANDLED, and this matters: answering "not handled" holds the watermark,
      // and every later scan would re-list a message that is no longer there.
      return true;
    }
    await ctx.persistMail(msg as IncomingMessage, { notify: ctx.notify });
    return true;
  }

  if (msg.msgType === MAIL_SYNC_MSG_TYPE) {
    return ctx.handleSync(msg);
  }

  // 'chat', 'webrtc-signaling', another app's `app:*`. Not touched and not
  // removed: the inbox is shared not only between the user's devices, but
  // between their applications. The body is not read at all.
  log.debug(`Ignoring inbox message ${msg.msgId} of type ${msg.msgType}.`);
  return true;
}

/** Whether the router will look at this message's body at all. */
export function isMsgOfThisApp(msgType: string | undefined): boolean {
  return (msgType === 'mail') || (msgType === MAIL_SYNC_MSG_TYPE);
}
