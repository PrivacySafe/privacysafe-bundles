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
import { THUMBNAIL_CACHE_MAX_CHARS } from '../../../shared/constants/attachment-limits.ts';
import { makeLogger } from '../../../shared/utils/logger.ts';
import { SYSTEM_FOLDERS } from '../../../src/common/constants/mail-folders-default.ts';
import type {
  IncomingMessage,
  IncomingMessageView,
  OutgoingMessageView,
} from '../../../src/common/types/mail.types.ts';
import type { InboxSrv } from '../../types/inbox-srv.types.ts';
import type { DBProvider } from '../../dataset/index.ts';
import { sameStoredMsgRow } from '../../dataset/utils.ts';
import { inboxBackupSrv } from '../../inbox-backup-srv.ts';
import type { SyncAspect } from '../../types/sync-types.ts';
import type { BlacklistTracker } from '../contacts-service/contacts-blacklist.ts';
import type { LabelledFileStore } from '../file-store/labelled-file-store.ts';
import {
  applyPlacement,
  diffMsgAspects,
  deliveryStateOf,
  isIncomingMsg,
  isMsgRead,
  placementOf,
  preserveEventStamps,
  type MsgAspect,
  type MsgView,
} from '../sync/msg-aspects.ts';
import { syncedRecordOf } from '../sync/record-mapping.ts';
import { drainOrphansFor } from '../sync/orphan-buffer.ts';
import {
  dispatchSync,
  handleIncomingSyncEnvelope,
  type IncomingSyncCtx,
} from '../sync/handle-incoming-sync.ts';
import type { SyncActivityTracker } from '../sync/sync-activity.ts';
import type { SyncOutbox } from '../sync/sync-outbox.ts';
import { createInboxEvents, type InboxEmit } from './events.ts';
import { sendOutgoingMessage, cancelOutgoingMessage } from './utils/send.ts';
import { deleteMessagesWithGc } from './utils/delete.ts';
import { persistIncomingMail } from './utils/receive.ts';

const log = makeLogger('InboxService');

export interface IncomingAttachmentMissingException extends web3n.RuntimeException {
  type: 'inbox';
  incomingAttachmentMissing: true;
  fileName: string;
}

function incomingAttachmentMissingExc(
  msgId: string,
  fileName: string,
): IncomingAttachmentMissingException {
  return {
    runtimeException: true,
    type: 'inbox',
    incomingAttachmentMissing: true,
    fileName,
    message: `Message ${msgId} has no attachment '${fileName}' any more`,
  };
}

/**
 * The message names a recipient the user has blocked.
 *
 * The window drops blocked addresses long before this, so in ordinary use this
 * is unreachable. It is the net under the two ways round the window: a draft
 * saved before the blocking and sent afterwards from Outbox, which goes by the
 * recipients stored in the record rather than by the form; and a blocking made
 * on another device that has reached this component but not yet the window.
 */
export interface BlockedRecipientsException extends web3n.RuntimeException {
  type: 'inbox';
  blockedRecipients: true;
  addresses: string[];
}

function blockedRecipientsExc(addresses: string[]): BlockedRecipientsException {
  return {
    runtimeException: true,
    type: 'inbox',
    blockedRecipients: true,
    addresses,
    message: `Message is addressed to blocked recipient(s): ${addresses.join(', ')}`,
  };
}

/**
 * The file was attached on another device of the user, and only the record
 * travelled here. Distinct from a missing or broken file: nothing is wrong with
 * it, it is simply somewhere else.
 */
export interface AttachmentOnAnotherDeviceException extends web3n.RuntimeException {
  type: 'inbox';
  attachmentOnAnotherDevice: true;
  fileName: string;
  originDeviceId?: string;
}

export function attachmentOnAnotherDeviceExc(
  fileName: string,
  originDeviceId?: string,
): AttachmentOnAnotherDeviceException {
  return {
    runtimeException: true,
    type: 'inbox',
    attachmentOnAnotherDevice: true,
    fileName,
    originDeviceId,
    message:
      `File '${fileName}' was attached on another device of this user`
      + (originDeviceId ? ` (${originDeviceId})` : '')
      + `, and its bytes are not on this one`,
  };
}

export async function inboxService(
  db: DBProvider,
  fileStore: LabelledFileStore,
  sync: SyncOutbox,
  ownAddr: string,
  watchStartup: InboxSrv['watchStartup'],
  blacklist: BlacklistTracker,
  activity?: SyncActivityTracker,
  /**
   * Replays the shared inbox from the watermark. A restore resets that watermark
   * to 0 and needs a pass right after itself, and the only thing that can make
   * such a pass is the mail service - which is built AFTER this one. So the hook
   * arrives as a box index.ts fills in once both exist, rather than as a
   * dependency that cannot be satisfied in this order.
   */
  rescan?: { run: () => Promise<void> },
): Promise<{
  inboxSrv: InboxSrv;
  emit: InboxEmit;
  /**
   * Opens and closes the window in which per-record changes are not reported one
   * by one. The start-up replay is bracketed with it (see index.ts).
   */
  beginBulkReplay: () => void;
  endBulkReplay: () => void;
  /** Where the mail service hands an ordinary incoming message. */
  persistMail: (msg: IncomingMessage, opts?: { notify?: boolean }) => Promise<void>;
  /** Where the mail service hands a message of the synchronization type. */
  handleSync: (msg: web3n.asmail.IncomingMessage) => Promise<boolean>;
}> {
  const { emit, watch, beginBulkReplay, endBulkReplay } = createInboxEvents();

  /**
   * One attempt per msgId per session at pulling a message out of the shared
   * inbox: a message that is not there will not appear because it was asked for
   * twice.
   */
  const pulledMsgIds = new Set<string>();

  /**
   * Writes records, emits their events, and announces the change once.
   *
   * Everything that changes messages goes through here, the local paths and the
   * ones a phantom brought alike - which is what keeps a bulk action to ONE
   * phantom instead of N, and what keeps the GUI from telling the two apart.
   */
  async function applyMsgChanges(
    changes: MsgView[],
    announce?: () => Promise<void>,
  ): Promise<void> {
    for (const msg of changes) {
      const existing = db.getMessageById(msg.msgId);
      if (existing) {
        await db.updateMessage(msg);
        emit({ entity: 'message', event: 'updated', msg, msgId: msg.msgId });
      } else {
        await db.addMessage(msg);
        emit({ entity: 'message', event: 'added', msg, msgId: msg.msgId });
      }
    }
    await announce?.();
  }

  const versionsOf = (msgId: string, aspects: SyncAspect[]) =>
    aspects.map(aspect => ({ entityType: 'msg' as const, entityId: msgId, aspect }));

  /**
   * Turns the aspects a change touched into phantoms.
   *
   * `msg` must be the record as STORED - that is the invariant the superseding of
   * 'content' rests on (see SyncedMsgRecord and planJournalRelease).
   */
  async function announceMsgAspects(msg: MsgView, aspects: Set<MsgAspect>): Promise<void> {
    if (aspects.size === 0) {
      return;
    }
    const incoming = isIncomingMsg(msg);

    // Content, or a record that is new here, goes as one msg-record carrying the
    // snapshots of the other aspects with it.
    if (aspects.has('content')) {
      await sync.announce({
        event: {
          kind: 'msg-record',
          msgId: msg.msgId,
          record: syncedRecordOf(msg, db.getAppDeviceId()),
        },
        aspects: versionsOf(msg.msgId, ['content', 'delivery', 'placement']),
      });
      return;
    }

    for (const aspect of aspects) {
      switch (aspect) {
        case 'read':
          await sync.announce({
            event: { kind: 'msg-read', msgIds: [msg.msgId], read: isMsgRead(msg) },
            aspects: versionsOf(msg.msgId, ['read']),
          });
          break;
        case 'placement':
          await sync.announce({
            event: {
              kind: 'msg-placement',
              msgIds: [msg.msgId],
              placement: placementOf(msg),
              incoming: incoming ? [msg.msgId] : [],
            },
            aspects: versionsOf(msg.msgId, ['placement']),
          });
          break;
        case 'delivery':
          await sync.announce({
            event: { kind: 'msg-delivery', msgId: msg.msgId, delivery: deliveryStateOf(msg) },
            aspects: versionsOf(msg.msgId, ['delivery']),
          });
          break;
        default:
          break;
      }
    }
  }

  /**
   * The public write point of the GUI. The aspect a change is about is worked out
   * from the records rather than from who is calling: everything the GUI does to
   * a message - saving a draft, marking as read, cancelling a send, restoring
   * from the trash - comes through this one method.
   */
  async function upsertMessage(msg: IncomingMessageView | OutgoingMessageView): Promise<void> {
    const existing = db.getMessageById(msg.msgId);
    // The event stamps of the stored record survive the save - see
    // preserveEventStamps for why this is the only place that can do it.
    const next = existing ? preserveEventStamps(existing, msg) : msg;
    const aspects = diffMsgAspects(existing ?? undefined, next);

    // A save that changes nothing stops here. The empty set of aspects already
    // kept it off the wire; without this it still cost a full-row rewrite, a
    // dirty database file, and a `message` event that replaces the record in the
    // window's store and invalidates every list computed over it. The draft form
    // saves as it opens, so this is the common case rather than a corner one.
    if (existing && (aspects.size === 0) && sameStoredMsgRow(existing, next)) {
      return;
    }

    await applyMsgChanges([next], () => announceMsgAspects(next, aspects));
  }

  /**
   * One placement phantom for a whole bulk move, and the records written in one
   * go. A loop over upsertMessage() would produce N phantoms - and N deliveries -
   * for one thing the user did.
   */
  async function movePlacement(
    msgIds: string[],
    place: (msg: MsgView) => MsgView,
  ): Promise<void> {
    const changes: MsgView[] = [];
    for (const msgId of msgIds) {
      const msg = db.getMessageById(msgId);
      if (msg) {
        changes.push(place(msg));
      }
    }
    if (changes.length === 0) {
      return;
    }

    const movedIds = changes.map(({ msgId }) => msgId);
    await applyMsgChanges(changes, () => sync.announce({
      event: {
        kind: 'msg-placement',
        msgIds: movedIds,
        placement: placementOf(changes[0]),
        // Which of them a receiving device may pull out of the shared inbox.
        incoming: changes.filter(isIncomingMsg).map(({ msgId }) => msgId),
      },
      aspects: movedIds.map(msgId => ({
        entityType: 'msg' as const,
        entityId: msgId,
        aspect: 'placement' as const,
      })),
      entityCount: movedIds.length,
    }));
  }

  const backup = inboxBackupSrv({
    db,
    fileStore,
    sync,
    emit,
    applyMsgChanges: changes => applyMsgChanges(changes),
    deleteMessages: (msgIds, token) =>
      deleteMessagesWithGc(db, fileStore, emit, msgIds, { sync: { token } }),
    beginBulkReplay,
    endBulkReplay,
    rescanInbox: () => rescan?.run() ?? Promise.resolve(),
  });

  const srv: InboxSrv = {
    async getAppState() {
      return db.getAppState();
    },

    async getAppDeviceId() {
      return db.getAppDeviceId();
    },

    async getSyncActivityState() {
      return activity?.snapshot() ?? { seq: 0, syncing: false, pending: 0, phase: 'idle', stalled: false };
    },

    async getBlacklistedAddresses() {
      return blacklist.getBlacklist();
    },

    async getFolderList() {
      return db.getFolderList();
    },

    async getMessages() {
      return db.getMessages();
    },

    async getMessage(msgId) {
      return db.getMessageById(msgId);
    },

    async getMessagesByThread(threadId) {
      return db.getMessagesByThread(threadId);
    },

    async forceRefreshData() {
      const messagesBefore = db.getMessages().length;
      await (rescan?.run() ?? Promise.resolve());
      return { applied: Math.max(0, db.getMessages().length - messagesBefore) };
    },

    upsertMessage,

    async moveToTrash(msgId) {
      await movePlacement([msgId], msg => ({ ...msg, mailFolder: SYSTEM_FOLDERS.trash }));
    },

    async bulkMoveToTrash(msgIds) {
      await movePlacement(msgIds, msg => ({ ...msg, mailFolder: SYSTEM_FOLDERS.trash }));
    },

    async bulkRestore(msgIds) {
      // homeFolderOf, and not a copy of the rule: a second copy diverges on the
      // first message whose sending failed.
      await movePlacement(msgIds, msg => applyPlacement(msg, { at: 'home' }));
    },

    async deleteMessages(msgIds) {
      // One token for the whole call, taken here because the deletion is applied
      // with it before the phantom is queued.
      const token = db.nextSyncToken();
      await deleteMessagesWithGc(db, fileStore, emit, msgIds, {
        sync: { token, announce: sync.announce },
      });
    },

    async addFolder(folder) {
      await db.upsertFolder(folder);
      emit({ entity: 'folder', event: 'updated', folder });
      await sync.announce({
        event: { kind: 'folder-record', folder },
        aspects: [{ entityType: 'folder', entityId: folder.id, aspect: 'folderProps' }],
      });
      return db.getFolderList();
    },

    async deleteFolder(folderId) {
      const folder = db.getFolderById(folderId);
      if (!folder) {
        return db.getFolderList();
      }
      await db.deleteFolder(folder);
      emit({ entity: 'folder', event: 'removed', folderId });
      await sync.announce({
        event: { kind: 'folder-deleted', folderId },
        aspects: [{
          entityType: 'folder',
          entityId: folderId,
          aspect: 'deleted',
          tombstonedAt: Date.now(),
          dropOtherAspects: true,
        }],
      });
      return db.getFolderList();
    },

    async sendMessage(msg) {
      // Refused whole, not quietly stripped of the blocked addresses: outcomeOf()
      // counts a delivery's result against msg.recipients, so a partial send
      // would leave the record claiming a recipient nothing was ever sent to.
      // Checked before upsertMessage, so a refused message is not marked
      // 'sending' on the way out either.
      const blocked = (msg.recipients ?? []).filter(addr => blacklist.isBlacklisted(addr));
      if (blocked.length > 0) {
        throw blockedRecipientsExc(blocked);
      }
      // No phantom of its own: upsertMessage on the line above has already
      // announced content and delivery(status 'sending').
      await upsertMessage(msg);
      await sendOutgoingMessage(db, fileStore, msg);
    },

    async cancelSendMessage(msgId) {
      // No phantom of its own either: the GUI writes status 'canceled' through
      // upsertMessage before calling this.
      await cancelOutgoingMessage(msgId);
    },

    async preFlight(recipient) {
      return w3n.mail!.delivery.preFlight(recipient);
    },

    async getReportAddressForDomain(domain: string): Promise<string> {
      return w3n.mail!.getReportAddressForDomain(domain);
    },

    addFile: (file, info) => fileStore.addFile(file, info),
    addLink: (file, info) => fileStore.addLink(file, info),

    async storeIncomingAttachment(incomingMsgId, fileName, msgId) {
      const file = await srv.getIncomingAttachment(incomingMsgId, fileName);
      if (!file) {
        throw incomingAttachmentMissingExc(incomingMsgId, fileName);
      }
      return fileStore.addFile(file, { fileName, messages: [msgId] });
    },

    async hasAttachment(id) {
      // An empty id is an answer, not a reason to read: the record came from
      // another device, and asking the file store would give the same answer
      // through an exception and a line of noise in the log.
      if (!id) {
        return false;
      }
      // getFile reads no bytes; for a link it is what resolving the target costs.
      return await fileStore
        .getFile(id)
        .then(() => true)
        .catch(() => false);
    },

    async getFile(id) {
      if (!id) {
        throw attachmentOnAnotherDeviceExc('');
      }
      return fileStore.getFile(id);
    },
    getInfo: id => fileStore.getInfo(id),
    updateInfo: (id, info) => fileStore.updateInfo(id, info),
    deleteFile: id => fileStore.delete(id),
    async copyFileTo(id, target) {
      if (!id) {
        throw attachmentOnAnotherDeviceExc('');
      }
      return fileStore.downloadFile(id, target);
    },

    /**
     * Copies what can be copied and SAYS how much it left out.
     *
     * A silent skip would put "Attachments have saved" over a folder some of the
     * files never reached; failing the whole batch would lose the available ones
     * for the sake of the unavailable.
     */
    async copyFilesTo(ids, fs) {
      const available = ids.filter((id): id is string => !!id);
      const skipped = ids.length - available.length;
      if (available.length > 0) {
        await fileStore.downloadFiles(available, fs);
      }
      return { skipped };
    },

    // A message the user has deleted is gone from the inbox, and asking for it
    // throws. Callers here treat "no such attachment" as an answer, not a
    // failure, so that a forward of a deleted message reports itself instead of
    // breaking whatever asked.
    //
    // These three need no change for synchronization and work on every device:
    // the bytes are in the shared inbox. That is what keeps a forward of a
    // synchronized incoming message complete.
    async getIncomingAttachment(msgId, fileName) {
      const msg = await w3n.mail?.inbox.getMsg(msgId).catch(() => undefined);
      if (!msg) {
        return null;
      }
      return (await msg.attachments?.readonlyFile(fileName).catch(() => undefined)) || null;
    },

    async getIncomingAttachmentsFS(msgId) {
      const msg = await w3n.mail?.inbox.getMsg(msgId).catch(() => undefined);
      return msg?.attachments || null;
    },

    async getThumbnails(msgId) {
      return db.getThumbnails(msgId);
    },

    async saveThumbnail(msgId, fileName, dataUrl) {
      // The database file is rewritten whole on every save, so an outsized
      // preview would be paid for on every write from then on. Dropping it costs
      // only that it has to be made again next time the message is opened.
      if (dataUrl.length > THUMBNAIL_CACHE_MAX_CHARS) {
        return;
      }
      await db.upsertThumbnail(msgId, fileName, dataUrl);
    },

    /**
     * The receiving tract, made callable.
     *
     * The test stand gives two USERS rather than two devices, so phantoms are
     * synthesized and fed to the live service through here - only the envelope is
     * synthetic, everything downstream is the ordinary path.
     */
    async handleIncomingSyncMsg(msg) {
      return handleIncomingSyncEnvelope(msg, syncCtx);
    },

    createBackupArchive: opts => backup.createBackupArchive(opts),
    cancelBackupArchive: () => backup.cancelBackupArchive(),
    validateBackupArchive: (bytes, outerMetadata) =>
      backup.validateBackupArchive(bytes, outerMetadata),
    restoreBackupArchive: (bytes, mode, outerMetadata) =>
      backup.restoreBackupArchive(bytes, mode, outerMetadata),

    watch,
    watchStartup,
  };

  const syncCtx: IncomingSyncCtx = {
    db,
    ownAddr,
    emit,
    applyMsgChanges: changes => applyMsgChanges(changes),
    deleteMessages: (msgIds, token) =>
      deleteMessagesWithGc(db, fileStore, emit, msgIds, { sync: { token } }),
    persistIncoming: msg => persistMail(msg, { notify: false }),
    pulledMsgIds,
    beginBulkReplay,
    endBulkReplay,
  };

  async function persistMail(msg: IncomingMessage, opts?: { notify?: boolean }): Promise<void> {
    await persistIncomingMail(db, emit, msg, {
      notify: opts?.notify,
      onAdded: msgId => drainOrphansFor(db, msgId, syncMsg => dispatchSync(syncMsg, syncCtx))
        .then(() => {}),
    });
  }

  async function handleSync(msg: web3n.asmail.IncomingMessage): Promise<boolean> {
    activity?.inboundEnqueued();
    activity?.beginApplyingInbound();
    try {
      return await handleIncomingSyncEnvelope(msg, syncCtx);
    } finally {
      activity?.endApplyingInbound();
      activity?.inboundDone();
    }
  }

  log.debug(`inbox service built for device ${db.getAppDeviceId()}`);

  return { inboxSrv: srv, emit, beginBulkReplay, endBulkReplay, persistMail, handleSync };
}

export { createInboxEvents };
