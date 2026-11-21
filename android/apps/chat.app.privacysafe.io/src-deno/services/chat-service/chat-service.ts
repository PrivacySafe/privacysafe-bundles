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
import type { ChatSrv, DB, LocalDataStore } from '../../types/index.ts';
import type { GuiLogLine } from '../../../shared-libs/log-relay.ts';
import { externalDrafts } from './external-drafts.ts';
import type { BlacklistTracker } from '../contacts-service/contacts-blacklist.ts';
import { contactBlockingRecords } from './utils/contact-blocking-records.ts';
import { checkAddressExistenceForASMail } from '../../utils/address-checks.ts';
import {
  countPhantomsAwaitingRelease,
  countSyncPhantomsInDelivery,
  releasePendingSyncPhantoms,
} from '../mail-sending-service/index.ts';
import { getIncomingMessage, saveThumbnailWithinLimit } from './utils/_msgs-related-methods.ts';
import { processOrphanedForChatCreation } from './utils/handle-incoming-sync.ts';
import { chatBackupSrv } from '../backup-service/chat-backup-srv.ts';
import { autoBackupService } from '../backup-service/auto-backup.ts';
import { syncedAutoBackupStorage } from '../backup-service/auto-backup-storage.ts';
import { hasLegacyDataOnSynced } from '../../dataset/index.ts';
import { requestResyncForStuckOrphans } from './utils/msg-resync.ts';
import { requestChatsResyncAtStartup, requestInitialChatsSnapshot } from './utils/chat-resync.ts';
import type { SyncActivityTracker } from '../../utils/sync-activity.ts';
import { createChatSrvCtx } from './chat-srv-ctx.ts';
import { makeIncomingMessages } from './incoming-messages.ts';
import { makeChatEntry } from './chat-entry.ts';
import { makeChatQueries } from './chat-queries.ts';
import { makeLocalMsgActions } from './local-msg-actions.ts';
import { makeLocalSystemEvents } from './local-system-events.ts';

/**
 * The chat service: assembles its parts and hands out the ChatSrv methods.
 *
 * The parts live next to this file (see doc/05, the map of chat-service
 * modules); what they share is ChatSrvCtx, made in chat-srv-ctx.ts.
 */
export async function chatService(
  ownAddr: string,
  localDataStoreSrv: LocalDataStore,
  data: DB,
  blacklistTracker?: BlacklistTracker,
): Promise<{ chatsSrv: ChatSrv; syncActivity: SyncActivityTracker }> {
  const ctx = await createChatSrvCtx({ ownAddr, localDataStore: localDataStoreSrv, data, blacklistTracker });
  const {
    filesStore,
    emit: emitEventAfterAction,
    watch,
    beginBulkReplay,
    endBulkReplay,
    syncActivity,
    resyncCtx,
    getAppDeviceId,
    nextSyncStamp,
    chatRenaming,
    chatSettingUp,
    chatDeletion,
    chatMembersUpdating,
    msgDeletion,
    msgStatusUpdating,
  } = ctx;

  const incoming = makeIncomingMessages(ctx);
  const chatEntry = makeChatEntry(ctx, incoming);
  const queries = makeChatQueries(ctx);
  const { getChat } = queries;
  const localMsgActions = makeLocalMsgActions(ctx, queries);
  const localSystemEvents = makeLocalSystemEvents(ctx, queries);

  /**
   * Backup and restore. Constructed after everything it leans on: the events
   * (for progress and the bulk-replay window), the file store, and the drain of
   * phantoms buffered before a chat existed - a restored chat can unblock them.
   */
  const backupSrv = chatBackupSrv({
    db: data,
    emit: emitEventAfterAction,
    filesStore,
    ownAddr,
    getAppDeviceId,
    nextSyncStamp,
    beginBulkReplay,
    endBulkReplay,
    drainOrphanedForChat: chatId =>
      processOrphanedForChatCreation(data, emitEventAfterAction, filesStore, chatId, ownAddr, resyncCtx),
  });

  /**
   * The automatic backup: this device's file in the synced storage, and the
   * restore of a new installation from the files of all devices. Built here,
   * started from index.ts (startAutoBackup) once the call check exists.
   */
  let autoBackupBusyCheck: (() => boolean) | undefined;
  const autoBackup = autoBackupService({
    db: data,
    storage: syncedAutoBackupStorage({
      mayClearRoot: async fs => !(await hasLegacyDataOnSynced(fs)),
    }),
    store: localDataStoreSrv,
    getAppVersion: () => w3n.myVersion(),
    isBusy: () => !!autoBackupBusyCheck?.(),
    restoreFiles: backupSrv.restoreFromAutoBackupFiles,
    emitInfo: info => emitEventAfterAction.common({ updatedEntityType: 'auto-backup', event: 'changed', info }),
  });

  /**
   * The main window's log lines, printed through this component so that the
   * whole run reads as one story (see ChatSrv.logFromGui).
   *
   * `w3n.log` directly rather than a scoped logger: the line arrives with its
   * own time, user address and scope already in it, and stamping it again with
   * this component's clock would put the moment of delivery where the moment of
   * the event should be.
   */
  async function logFromGui(lines: GuiLogLine[]): Promise<void> {
    for (const { level, line, details } of lines) {
      await w3n.log(level, `[GUI:main] ${line}`, details).catch(() => {});
    }
  }

  const drafts = externalDrafts(filesStore, getChat);

  const methods: ChatSrv = {
    emitEventsOutward: emitEventAfterAction,
    getAppDeviceId,
    logFromGui,
    handleIncomingMsg: incoming.handleIncomingMsg,
    forceRefreshChat: incoming.forceRefreshChat,
    createOneToOneChat: chatEntry.createOneToOneChat,
    acceptChatInvitation: chatEntry.acceptChatInvitation,
    createGroupChat: chatEntry.createGroupChat,
    getChatList: queries.getChatList,
    renameChat: chatRenaming.renameChat,
    chatSetUp: chatSettingUp.setUp,
    deleteChat: chatDeletion.deleteChat,
    updateGroupMembers: chatMembersUpdating.updateGroupMembers,
    updateGroupAdmins: chatMembersUpdating.updateGroupAdmins,
    getChat,
    findChatEntry: queries.findChatEntry,
    getOneToOneChatStatus: drafts.getOneToOneChatStatus,
    prepareOutgoingDraft: drafts.prepareOutgoingDraft,
    takeExternalDraft: drafts.takeExternalDraft,
    deleteMessagesInChat: msgDeletion.deleteMessagesInChat,
    deleteMessage: msgDeletion.deleteMessage,
    deleteMessages: msgDeletion.deleteMessages,
    deleteExpiredMessages: msgDeletion.deleteExpiredMessages,
    collectGarbageInAuxiliaryDB: data.collectGarbageInAuxiliaryDB,
    removeExpiredInboxMessages: msgDeletion.removeExpiredInboxMessages,
    resolveStuckSyncingSelfMessages: msgStatusUpdating.resolveStuckSyncingSelfMessages,
    collectGarbageInSyncVersions: data.collectGarbageInSyncVersions,
    // The outcome is reported by the pass itself, through the sink wired in
    // createChatSrvCtx():
    // this method is one caller of many, and the ones it is not are the ones
    // that run while the user is doing something.
    releasePendingSyncPhantoms: () => releasePendingSyncPhantoms(data, ownAddr),
    countPendingSyncPhantoms: async () => countPhantomsAwaitingRelease(data),
    countSyncPhantomsInDelivery: async () => countSyncPhantomsInDelivery(),
    getSyncActivityState: async () => syncActivity.snapshot(),
    requestResyncForStuckOrphans: () => requestResyncForStuckOrphans(resyncCtx),
    requestChatsResyncAtStartup: () => requestChatsResyncAtStartup(resyncCtx),
    requestInitialChatsSnapshot: () => requestInitialChatsSnapshot(resyncCtx),
    startAutoBackup: isBusy => {
      autoBackupBusyCheck = isBusy;
      autoBackup.start();
    },
    getAutoBackupInfo: async () => autoBackup.getInfo(),
    setAppSettings: autoBackup.setSettings,
    listAutoBackups: autoBackup.listAutoBackups,
    restoreFromAutoBackups: autoBackup.restoreFromAutoBackups,
    setResyncBusyCheck: isBusy => {
      resyncCtx.isBusy = isBusy;
    },
    syncLocallyMadeSystemEvent: localSystemEvents.syncLocallyMadeSystemEvent,
    getBlacklistedAddresses: async () => blacklistTracker?.getBlacklist() ?? [],
    getLatestIncomingMsgTimestamp: data.getLatestIncomingMsgTimestamp,
    getMessage: queries.getMessage,
    getMessagesByChat: queries.getMessagesByChat,
    getMessagesPageByChat: queries.getMessagesPageByChat,
    searchMessagesInChat: queries.searchMessagesInChat,
    getIncomingMessage,
    getRecentReactions: data.getRecentReactions,
    getThumbnails: async id => data.getThumbnails(id),
    saveThumbnail: (id, fileName, dataUrl) => saveThumbnailWithinLimit(data, id, fileName, dataUrl),
    sendRegularMessage: localMsgActions.sendRegularMessage,
    cancelSendingMessage: localMsgActions.cancelSendingMessage,
    markMessageAsReadNotifyingSender: msgStatusUpdating.markMessageAsReadNotifyingSender,
    checkAddressExistenceForASMail: checkAddressExistenceForASMail,
    sendSystemDeletableMessage: localMsgActions.sendSystemDeletableMessage,
    updateEarlySentMessage: localMsgActions.updateEarlySentMessage,
    changeMessageReaction: localMsgActions.changeMessageReaction,
    makeAndSaveMsgToDb: localSystemEvents.makeAndSaveMsgToDb,
    saveAndSyncLocalSystemMsg: localSystemEvents.saveAndSyncLocalSystemMsg,
    createBackupPlan: backupSrv.createBackupPlan,
    cancelBackupPlan: backupSrv.cancelBackupPlan,
    previewRestore: backupSrv.previewRestore,
    restoreBackupArchive: backupSrv.restoreBackupArchive,
    watch,
    onIncomingCallSysMsg: incoming.onIncomingCallSysMsg,
  };

  // A change of the blacklist leaves its mark in the chats of the contact it
  // is about. Registered here, before the tracker is started in index.ts: a
  // change arriving with no handler in place is not replayed.
  if (blacklistTracker) {
    const { handleBlacklistChanges } = contactBlockingRecords({
      data,
      emit: emitEventAfterAction,
      ownAddr,
    });
    blacklistTracker.setChangeHandler(changes => {
      handleBlacklistChanges(changes).catch(err =>
        w3n.log('error', `Fail to write contact blocking records`, err),
      );
    });
  }

  // IPC exposure is NOT done here: it must happen at the very start of the
  // component (see index.ts), long before this service can be constructed.

  return {
    chatsSrv: methods,
    syncActivity,
  };
}
