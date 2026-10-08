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
import { msgsDb } from './msgs-db.ts';
import { chatsDb } from './chats-db.ts';
import { setDbFlush } from './db-flush.ts';
import { startupStage } from '../utils/startup-progress.ts';
import type { DB } from '../types/index.ts';

export async function dataset(): Promise<DB> {
  // Named steps, because this is where a start-up that never finishes is most
  // likely to be standing: both database files live on storage the platform
  // synchronizes, and a run whose log stops here used to name nothing at all
  // (see startup-progress.ts).
  const fs = await startupStage('dataset/synced-fs', () => w3n.storage!.getAppSyncedFS(), 10000);
  const fsLocal = await startupStage('dataset/local-fs', () => w3n.storage!.getAppLocalFS(), 10000);

  const msgsBdSrv = await startupStage('dataset/msgs-db', () => msgsDb({ fs, fsLocal }), 10000);
  const chatsBdSrv = await startupStage(
    'dataset/chats-db', () => chatsDb({ fs, fsLocal, msgsBdSrv }), 10000,
  );

  /**
   * Covers all three database files: the messages one, its auxiliary, and
   * the chats one.
   */
  async function flush(): Promise<void> {
    await Promise.all([msgsBdSrv.flush(), chatsBdSrv.flush()]);
  }

  // Lets the sending layer flush without holding a reference to the DB.
  setDbFlush(flush);

  return {
    flush,
    addMessage: msgsBdSrv.addMessage,
    getMessage: msgsBdSrv.getMessage,
    isMsgKeptForInboxMsg: msgsBdSrv.isMsgKeptForInboxMsg,
    getAllMessages: msgsBdSrv.getAllMessages,
    countMessages: msgsBdSrv.countMessages,
    countMessagesInChat: msgsBdSrv.countMessagesInChat,
    getExpiredMessages: msgsBdSrv.getExpiredMessages,
    getMessagesByChat: msgsBdSrv.getMessagesByChat,
    getMessagesPageInChat: msgsBdSrv.getMessagesPageInChat,
    getNotRegularMessagesByChat: msgsBdSrv.getNotRegularMessagesByChat,
    getMessagesWithSyncingSelfStatus: msgsBdSrv.getMessagesWithSyncingSelfStatus,
    getLatestIncomingMsgTimestamp: msgsBdSrv.getLatestIncomingMsgTimestamp,
    getLatestIncomingMsgTimestampInChat: msgsBdSrv.getLatestIncomingMsgTimestampInChat,
    getLatestMsgInChat: msgsBdSrv.getLatestMsgInChat,
    getUnreadMsgsCountIn: msgsBdSrv.getUnreadMsgsCountIn,
    getRecentReactions: msgsBdSrv.getRecentReactions,
    deleteMessage: msgsBdSrv.deleteMessage,
    deleteMessagesInChat: msgsBdSrv.deleteMessagesInChat,
    updateMessageRecord: msgsBdSrv.updateMessageRecord,
    updateMessageStatus: msgsBdSrv.updateMessageStatus,
    addOrphanedMessage: msgsBdSrv.addOrphanedMessage,
    getStuckMessagesForTargetMessageId: msgsBdSrv.getStuckMessagesForTargetMessageId,
    getStuckMessagesWithoutTarget: msgsBdSrv.getStuckMessagesWithoutTarget,
    getStuckOrphanTargets: msgsBdSrv.getStuckOrphanTargets,
    countOrphanedSyncs: msgsBdSrv.countOrphanedSyncs,
    deleteOrphanedMessage: msgsBdSrv.deleteOrphanedMessage,
    collectGarbageInAuxiliaryDB: msgsBdSrv.collectGarbageInAuxiliaryDB,
    scheduleInboxMsgRemoval: msgsBdSrv.scheduleInboxMsgRemoval,
    getDueInboxMsgRemovals: msgsBdSrv.getDueInboxMsgRemovals,
    clearInboxMsgRemovals: msgsBdSrv.clearInboxMsgRemovals,
    getThumbnails: msgsBdSrv.getThumbnails,
    upsertThumbnail: msgsBdSrv.upsertThumbnail,
    deleteThumbnails: msgsBdSrv.deleteThumbnails,
    getSyncVersion: msgsBdSrv.getSyncVersion,
    setSyncVersion: msgsBdSrv.setSyncVersion,
    getAllSyncVersions: msgsBdSrv.getAllSyncVersions,
    setSyncVersions: msgsBdSrv.setSyncVersions,
    deleteSyncVersionsOf: msgsBdSrv.deleteSyncVersionsOf,
    collectGarbageInSyncVersions: msgsBdSrv.collectGarbageInSyncVersions,
    queueSyncPhantom: msgsBdSrv.queueSyncPhantom,
    getPendingSyncPhantoms: msgsBdSrv.getPendingSyncPhantoms,
    countPendingSyncPhantoms: msgsBdSrv.countPendingSyncPhantoms,
    deletePendingSyncPhantom: msgsBdSrv.deletePendingSyncPhantom,
    recordPendingSyncPhantomFailure: msgsBdSrv.recordPendingSyncPhantomFailure,
    dropExpiredSyncPhantoms: msgsBdSrv.dropExpiredSyncPhantoms,
    findChat: chatsBdSrv.findChat,
    addOneToOneChat: chatsBdSrv.addOneToOneChat,
    addGroupChat: chatsBdSrv.addGroupChat,
    addOTOChatRecord: chatsBdSrv.addOTOChatRecord,
    addGroupChatRecord: chatsBdSrv.addGroupChatRecord,
    updateOTOChatRecord: chatsBdSrv.updateOTOChatRecord,
    updateGroupChatRecord: chatsBdSrv.updateGroupChatRecord,
    getChatList: chatsBdSrv.getChatList,
    getChatsWithParticipant: chatsBdSrv.getChatsWithParticipant,
    deleteChat: chatsBdSrv.deleteChat,
  };
}
