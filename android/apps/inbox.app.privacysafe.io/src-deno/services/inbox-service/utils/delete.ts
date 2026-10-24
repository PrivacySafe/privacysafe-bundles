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
import type { FileInfo } from '../../../types/inbox-srv.types.ts';
import type { DBProvider } from '../../../dataset/index.ts';
import type { SyncToken } from '../../../types/sync-types.ts';
import type { LabelledFileStore } from '../../file-store/labelled-file-store.ts';
import type { SyncOutbox } from '../../sync/sync-outbox.ts';
import type { InboxEmit } from '../events.ts';
import { makeLogger } from '../../../../shared/utils/logger.ts';

const log = makeLogger('InboxDelete');

/**
 * Deletes messages for good, one function for both paths - the local one and the
 * one a phantom brought.
 *
 * One function on purpose: two paths would inevitably drift apart on the file GC
 * and on the previews, which is exactly what happened to the previews before
 * (see the note about the foreign key below).
 *
 * @param opts.sync.token the ordering token of the deletion. ONE token for the
 *        whole call: a bulk deletion is one thing the user did, and different
 *        stamps for its parts would only put N extra rows in the journal.
 * @param opts.sync.announce present for a LOCAL deletion - where the phantom
 *        goes, and what writes the tombstones together with the journal row in
 *        one operation. Absent for a deletion that came in a phantom, whose
 *        tombstones the receiving tract has already recorded.
 */
export async function deleteMessagesWithGc(
  db: DBProvider,
  fileStore: LabelledFileStore,
  emit: InboxEmit,
  messageIds: string[],
  opts?: {
    sync?: {
      token: SyncToken;
      announce?: SyncOutbox['announce'];
    };
  },
): Promise<void> {
  const incomingMessages: string[] = [];
  const outgoingMessages: string[] = [];
  const filesIds: string[] = [];

  for (let i = 0; i < messageIds.length; i++) {
    const msgId = messageIds[i];

    // Before the check below, and for every id asked about: previews are keyed
    // by message and nothing else will clean them up - the foreign key that
    // would have is not enforced, PRAGMA foreign_keys never being turned on. A
    // preview left behind by a message record that is already gone would
    // otherwise stay for good.
    await db.deleteThumbnails(msgId, true);

    const msg = db.getMessageById(msgId);
    if (!msg) {
      continue;
    }

    const isMsgIncoming = 'sender' in msg && 'deliveryTS' in msg;
    if (isMsgIncoming) {
      incomingMessages.push(msgId);
    } else {
      outgoingMessages.push(msgId);
      for (const item of msg.attachmentsInfo || []) {
        // KEEP THIS CHECK. An attachment attached on another device of the user
        // travels here without an id, its bytes being in that device's file
        // store; there is nothing here to collect, and asking the store about an
        // empty id would only produce noise. Removing this as "why is there a
        // check" is a live hazard.
        if (item.id) {
          filesIds.push(item.id);
        }
      }
    }

    await db.deleteMessageById(msgId, i < messageIds.length - 1);
    emit({ entity: 'message', event: 'removed', msgId });
  }

  const uniqueFileIds = [...new Set(filesIds)];
  for (const fileId of uniqueFileIds) {
    try {
      const { messages = [] } = (await fileStore.getInfo(fileId)) as FileInfo;
      const updatedMessages = messages.filter(mId => !messageIds.includes(mId));
      if (updatedMessages.length > 0) {
        await fileStore.updateInfo(fileId, { messages: updatedMessages });
      } else {
        await fileStore.delete(fileId);
      }
    } catch (err) {
      log.error(`Failed to GC file ${fileId}`, err);
    }
  }

  // The tombstones and the journal row go in together, in one operation, before
  // anything irreversible happens.
  if (opts?.sync?.announce && (messageIds.length > 0)) {
    const tombstonedAt = Date.now();
    await opts.sync.announce({
      event: { kind: 'msg-deleted', msgIds: messageIds },
      aspects: messageIds.map(msgId => ({
        entityType: 'msg' as const,
        entityId: msgId,
        aspect: 'deleted' as const,
        tombstonedAt,
        // Same as recordDeletion(): the entity's other aspect versions go, the
        // tombstone stays.
        dropOtherAspects: true,
      })),
      entityCount: messageIds.length,
      token: opts.sync.token,
    });
  }

  if (incomingMessages.length > 0) {
    // Removal from the server cannot be undone, so the deletions - the
    // tombstones among them - have to be in the file first; otherwise a crash
    // brings back records of messages that no longer exist anywhere.
    await db.flush();

    const outcomes = await Promise.allSettled(
      incomingMessages.map(async msgId => {
        await w3n.mail?.inbox.removeMsg(msgId);
        return msgId;
      }),
    );
    const unremoved = incomingMessages.filter((_, i) => outcomes[i].status === 'rejected');
    if (unremoved.length > 0) {
      // A refusal used to mean the message stayed in the inbox for good. Due at
      // once, so the next maintenance pass takes it on; until then the tombstone
      // is what keeps a scan from bringing the message back.
      log.error(
        `Failed to remove ${unremoved.length} message(s) from the inbox; they are scheduled `
          + `for another attempt.`,
      );
      for (const msgId of unremoved) {
        await db.scheduleInboxMsgRemoval(msgId, true, 0);
      }
      await db.flush();
    }
  } else {
    // Nothing irreversible here, but the deletions must not sit unwritten
    // either: this is the path a phantom's deletion takes.
    await db.flush();
  }

  if (outgoingMessages.length > 0) {
    const deliveryList = await w3n.mail?.delivery.listMsgs();
    const deliveryListIds = (deliveryList || [])
      .filter(item => outgoingMessages.includes(item.id))
      .map(item => item.id);
    await Promise.allSettled(deliveryListIds.map(msgId => w3n.mail?.delivery.rmMsg(msgId)));
  }
}
