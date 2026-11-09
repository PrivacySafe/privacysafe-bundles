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
import type { ChatSrvEmit, DB, FileStoreService, LocalDataStore } from '../../types/index.ts';
import type { BlacklistTracker } from '../contacts-service/contacts-blacklist.ts';
import { createChatEvents } from './events.ts';
import { fileStoreService } from '../file-store-service/file-store-service.ts';
import { AppSettings } from '../../utils/app-settings.ts';
import {
  countPhantomsAwaitingRelease,
  setSyncDeliveryOutcomeSink,
  setSyncPassOutcomeSink,
} from '../mail-sending-service/index.ts';
import { chatCreation as _chatCreation } from './utils/chat-creation.ts';
import { chatRenaming as _chatRenaming } from './utils/chat-renaming.ts';
import { chatSettingUp as _chatSettingUp } from './utils/chat-setting-up.ts';
import { chatDeletion as _chatDeletion } from './utils/chat-deletion.ts';
import { chatMemberRemoval as _chatMemberRemoval } from './utils/chat-member-removal.ts';
import { chatMembersUpdating as _chatMembersUpdating } from './utils/chat-members-updating.ts';
import { webRTCCallReaction as _webRTCCallReaction } from './utils/webrtc-call-reaction.ts';
import { msgSending as _msgSending } from './utils/msg-sending.ts';
import { msgDeletion as _msgDeletion } from './utils/msg-deletion.ts';
import { msgStatusUpdating as _msgStatusUpdating } from './utils/msg-status-updating.ts';
import { msgReactions as _msgReactions } from './utils/msg-reactions.ts';
import { msgEditing as _msgEditing } from './utils/msg-editing.ts';
import { makeResyncCtx, type ResyncCtx } from './utils/msg-resync.ts';
import { makeSyncActivityTracker, type SyncActivityTracker } from '../../utils/sync-activity.ts';

type ChatEvents = ReturnType<typeof createChatEvents>;

/**
 * What the parts of the chat service share: the arguments of chatService(),
 * the event sink, the synchronization machinery, and the handlers of
 * individual chat operations from utils/.
 *
 * Made once per service, in createChatSrvCtx(). A module takes what it needs
 * out of here at its construction; nothing in it is ever replaced.
 */
export interface ChatSrvCtx {
  readonly ownAddr: string;
  readonly data: DB;
  readonly localDataStore: LocalDataStore;
  readonly blacklistTracker?: BlacklistTracker;
  readonly filesStore: FileStoreService;
  readonly appSettings: AppSettings;

  /** Events for the GUI, emitted after an action is done. */
  readonly emit: ChatSrvEmit;
  readonly watch: ChatEvents['watch'];
  readonly beginBulkReplay: ChatEvents['beginBulkReplay'];
  readonly endBulkReplay: ChatEvents['endBulkReplay'];

  readonly syncActivity: SyncActivityTracker;
  readonly resyncCtx: ResyncCtx;
  readonly getAppDeviceId: () => string;
  readonly nextSyncStamp: () => Promise<number>;

  readonly chatCreation: Awaited<ReturnType<typeof _chatCreation>>;
  readonly chatRenaming: Awaited<ReturnType<typeof _chatRenaming>>;
  readonly chatSettingUp: Awaited<ReturnType<typeof _chatSettingUp>>;
  readonly chatDeletion: Awaited<ReturnType<typeof _chatDeletion>>;
  readonly chatMemberRemoval: Awaited<ReturnType<typeof _chatMemberRemoval>>;
  readonly chatMembersUpdating: Awaited<ReturnType<typeof _chatMembersUpdating>>;
  readonly webRTCCallReaction: Awaited<ReturnType<typeof _webRTCCallReaction>>;
  readonly msgSending: Awaited<ReturnType<typeof _msgSending>>;
  readonly msgDeletion: Awaited<ReturnType<typeof _msgDeletion>>;
  readonly msgStatusUpdating: Awaited<ReturnType<typeof _msgStatusUpdating>>;
  readonly msgReactions: Awaited<ReturnType<typeof _msgReactions>>;
  readonly msgEditing: Awaited<ReturnType<typeof _msgEditing>>;
}

export async function createChatSrvCtx({
  ownAddr,
  localDataStore: localDataStoreSrv,
  data,
  blacklistTracker,
}: {
  ownAddr: string;
  localDataStore: LocalDataStore;
  data: DB;
  blacklistTracker?: BlacklistTracker;
}): Promise<ChatSrvCtx> {
  const filesStore = await fileStoreService();
  const appSettings = new AppSettings();

  const { emit: emitEventAfterAction, watch, beginBulkReplay, endBulkReplay } =
    createChatEvents(ownAddr, data);

  function getAppDeviceId() {
    return localDataStoreSrv.getAppDeviceId();
  }

  function nextSyncStamp() {
    return localDataStoreSrv.nextSyncStamp();
  }

  /**
   * Tracker of synchronization work, for the indicator in the GUI. It is made
   * here, where both the event sink and the database are already at hand, and
   * handed out to the inbox dispatcher through startup wiring.
   */
  const syncActivity = makeSyncActivityTracker({
    // Rows awaiting release, not every journal row: a row inside a delivery is
    // waiting for a confirmation, which is not work the user can be told about -
    // counting it would keep the indicator lit for as long as the platform takes
    // to report an outcome (tens of seconds, sometimes never).
    countOutboundPending: () => countPhantomsAwaitingRelease(data),
    // Nothing is reported until this user is known to have a second device.
    // Their own phantoms come back to their own inbox, so a single-device user
    // was told about "synchronization" that consisted entirely of this device
    // cleaning up after itself (2026-08-14).
    isReportable: () => localDataStoreSrv.hasSeenOtherDevice(),
  });
  syncActivity.onChange(state => emitEventAfterAction.common({
    updatedEntityType: 'sync-state',
    event: 'changed',
    state,
  }));

  // Wired here, at the construction of the service, because the first pass over
  // the journal runs at start-up (index.ts) - and because most passes are
  // started from inside the sending service itself, where this service is not
  // in reach. Reporting the outcome only from the IPC method
  // (releasePendingSyncPhantoms in chat-service.ts) left every
  // pass of a running app unreported: a journal held back by a call looked to
  // the indicator exactly like work in progress, so it showed "Synchronizing…"
  // for the whole length of every call (2026-08-14).
  setSyncPassOutcomeSink(outcome => syncActivity.noteOutboundPass(outcome));
  setSyncDeliveryOutcomeSink(outcome => syncActivity.noteOutboundDeliveryOutcome(outcome));

  /**
   * Shared context of the record-resync mechanism (see msg-resync.ts): its
   * per-session dedup of asks must be one for all the places that can notice
   * a missing record - incoming sync handling and the start-up pass alike.
   */
  const resyncCtx = makeResyncCtx({
    db: data,
    ownAddr,
    getAppDeviceId,
    nextSyncStamp,
    // The persisted side of 'resync:chats' (see chat-resync.ts).
    chatsResyncState: {
      isInitialAskDue: () => localDataStoreSrv.isInitialChatsSnapshotAskDue(),
      noteInitialAsked: requestId => localDataStoreSrv.noteInitialChatsSnapshotAsked(requestId),
      noteInitialAnswered: requestId => localDataStoreSrv.noteInitialChatsSnapshotAnswered(requestId),
      wasAnswered: key => localDataStoreSrv.wasChatsResyncAnswered(key),
      noteAnswered: key => localDataStoreSrv.noteChatsResyncAnswered(key),
    },
  });

  const chatCreation = await _chatCreation({
    ownAddr,
    data,
    appSettings,
    emit: emitEventAfterAction,
    filesStore,
    getAppDeviceId,
    nextSyncStamp,
    resync: resyncCtx,
  });
  const chatRenaming = await _chatRenaming({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    getAppDeviceId,
    nextSyncStamp,
  });
  const chatSettingUp = await _chatSettingUp({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    getAppDeviceId,
    nextSyncStamp,
  });
  const chatDeletion = await _chatDeletion({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    filesStore,
    getAppDeviceId,
    nextSyncStamp,
  });
  const chatMemberRemoval = await _chatMemberRemoval({ ownAddr, data, emit: emitEventAfterAction });
  const chatMembersUpdating = await _chatMembersUpdating({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    getAppDeviceId,
    nextSyncStamp,
  });
  const webRTCCallReaction = await _webRTCCallReaction(emitEventAfterAction);
  const msgSending = await _msgSending({
    ownAddr,
    data,
    appSettings,
    emit: emitEventAfterAction,
    filesStore,
    getAppDeviceId,
    nextSyncStamp,
  });
  const msgDeletion = await _msgDeletion({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    filesStore,
    getAppDeviceId,
    nextSyncStamp,
  });
  const msgStatusUpdating = await _msgStatusUpdating({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    getAppDeviceId,
    nextSyncStamp,
  });
  const msgReactions = await _msgReactions({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    getAppDeviceId,
    nextSyncStamp,
  });
  const msgEditing = await _msgEditing({
    ownAddr,
    data,
    emit: emitEventAfterAction,
    getAppDeviceId,
    nextSyncStamp,
  });

  return {
    ownAddr,
    data,
    localDataStore: localDataStoreSrv,
    blacklistTracker,
    filesStore,
    appSettings,
    emit: emitEventAfterAction,
    watch,
    beginBulkReplay,
    endBulkReplay,
    syncActivity,
    resyncCtx,
    getAppDeviceId,
    nextSyncStamp,
    chatCreation,
    chatRenaming,
    chatSettingUp,
    chatDeletion,
    chatMemberRemoval,
    chatMembersUpdating,
    webRTCCallReaction,
    msgSending,
    msgDeletion,
    msgStatusUpdating,
    msgReactions,
    msgEditing,
  };
}
