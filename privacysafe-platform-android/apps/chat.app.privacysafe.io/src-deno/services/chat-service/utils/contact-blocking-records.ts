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
import type { ChatSystemMessageData } from '../../../../types/asmail-msgs.types.ts';
import type { ChatSrvEmit, DB } from '../../../types/index.ts';
import { areAddressesEqual } from '../../../../shared-libs/address-utils.ts';
import { generateChatMessageId } from '../../../../shared-libs/chat-ids.ts';
import { makeMsgDbEntry } from './_msgs-related-methods.ts';
import type { BlacklistChanges } from '../../contacts-service/contacts-blacklist.ts';
import { makeLogger } from '../../../../shared-libs/logger.ts';

const log = makeLogger('ContactBlockingRecords');

/**
 * Writes the "you blocked / unblocked this contact" lines into the chats the
 * contact takes part in.
 *
 * These records are made purely locally, and deliberately so. Nothing is sent
 * to peers - the blocked side is not told - and nothing is synchronized to the
 * user's other devices either: the blacklist is replicated by the contacts
 * app, so the watcher fires on every device and each one writes its own line.
 * A sync phantom on top of that would produce a second line, not a shared one.
 *
 * The consequence to be aware of: a device that was not running between a block
 * and the matching unblock sees only the net result of the two, and writes
 * neither line. Its history is then shorter than its neighbours', which is the
 * price of not having to reconcile two writers of one record.
 */
export function contactBlockingRecords({
  data,
  emit,
  ownAddr,
}: {
  data: DB;
  emit: ChatSrvEmit;
  ownAddr: string;
}) {
  async function writeRecordsFor(cAddr: string, event: ChatSystemMessageData['event']): Promise<void> {
    // Blocking oneself is not a thing the contacts app can express, but a chat
    // with one's own address is - and a line about it would be nonsense.
    if (areAddressesEqual(cAddr, ownAddr)) {
      return;
    }

    const chatIds = data.getChatsWithParticipant(cAddr);
    if (chatIds.length === 0) {
      return;
    }

    const chatSystemData = { event, value: { mail: cAddr } } as ChatSystemMessageData;

    for (const chatId of chatIds) {
      const { chatMessageId, timestamp } = generateChatMessageId();
      const msg = makeMsgDbEntry('system', chatMessageId, {
        groupChatId: chatId.isGroupChat ? chatId.chatId : null,
        otoPeerCAddr: chatId.isGroupChat ? null : chatId.chatId,
        groupSender: chatId.isGroupChat ? ownAddr : null,
        body: JSON.stringify(chatSystemData),
        timestamp,
      });

      try {
        await data.addMessage(msg);
        emit.message.added(msg);
      } catch (err) {
        // One chat failing must not cost the others their line.
        log.error(`Failed to write '${event}' record for ${cAddr} into chat ${chatId.chatId}:`, err);
      }
    }
  }

  /**
   * Handles one change of the blacklist. Not awaited by the tracker - it calls
   * this from inside the contacts watcher, where nothing may block - so this
   * must never reject.
   */
  async function handleBlacklistChanges({ added, removed }: BlacklistChanges): Promise<void> {
    try {
      for (const cAddr of added) {
        await writeRecordsFor(cAddr, 'contact:blocked');
      }
      // A contact deleted from the address book leaves the blacklist with it,
      // and is reported here as removed. Writing "unblocked" for it is correct:
      // that contact is no longer blocked, whichever way it got there.
      for (const cAddr of removed) {
        await writeRecordsFor(cAddr, 'contact:unblocked');
      }
    } catch (err) {
      log.error(`Failed to handle a blacklist change:`, err);
    }
  }

  return { handleBlacklistChanges };
}
