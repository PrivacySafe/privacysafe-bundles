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
import type {
  ChatIdObj,
  ChatIncomingMessage,
  ChatMessageId,
  ChatSystemMessageData,
  ChatSystemMsgV1,
  RelatedMessage,
  UpdateMembersSysMsgData,
  UpdateAdminsSysMsgData,
  ChatOutgoingMessage,
  WebRTCMsgBodySysMsgData,
} from '../../types/asmail-msgs.types.ts';
import type {
  GroupChatView,
  ChatListItemView,
  ChatMessageReaction,
  ChatMessageView,
  MsgPageCursor,
  MsgsDeletionResult,
  OutgoingAttachment,
  SingleChatView,
} from '../../types/chat.types.ts';
import type {
  AddressCheckResult,
  ComponentStatus,
  SyncActivityView,
  UpdateEvent,
} from '../../types/services.types.ts';
import type {
  BackupPlan,
  BackupRecordFiles,
  RestoreMode,
  RestoreOutcome,
  RestorePreview,
} from '../../types/backup.types.ts';
import type { GuiLogLine } from '../../shared-libs/log-relay.ts';
import type { SyncPhantomReleaseResult } from '../services/mail-sending-service/sync-phantoms.ts';
import type { ChatDbEntry, ChatSettings, GroupChatDbEntry, OTOChatDbEntry } from './chat-db.types.ts';
import type { MsgDbEntry } from './msgs-db.types.ts';

export interface SendingProgressInfo {
  id: string;
  progress: web3n.asmail.DeliveryProgress;
}

export interface ChatSrvEmit {
  common: (event: UpdateEvent) => void;
  chat: {
    added: (chat: GroupChatDbEntry | OTOChatDbEntry) => void;
    removed: (chatId: ChatIdObj) => void;
    updated: (chat: GroupChatDbEntry | OTOChatDbEntry | undefined) => void;
    allMsgsRemoved: (chatId: ChatIdObj) => void;
    webRTCCall: (msg: ChatIncomingMessage | ChatOutgoingMessage, value: WebRTCMsgBodySysMsgData['value']) => void;
  };
  message: {
    added: (msg: MsgDbEntry) => void;
    removed: (msgId: ChatMessageId) => void;
    removedMultiple: (chatMsgIds: ChatMessageId[]) => void;
    updated: (msg: MsgDbEntry | undefined) => void;
  };
}

export interface ChatSrv {
  emitEventsOutward: ChatSrvEmit;

  getAppDeviceId(): string;

  /**
   * Prints the main window's log lines where the whole run can be read: this
   * component's own output, i.e. the test stand's stdout.
   *
   * A window's `w3n.log` reaches only that window's devtools console, and the
   * platform's log file carries core entries alone - so a run's three parts
   * (this component, the main window, the call window) could not be read as one
   * story. The call window has a channel of its own (see the 'gui-log' event in
   * CallFromVideoGUI); this method is the main window's.
   *
   * Lines arrive composed, and are printed as they are - see log-relay.ts.
   */
  logFromGui(lines: GuiLogLine[]): Promise<void>;

  handleIncomingMsg(msg: ChatIncomingMessage): Promise<void>;

  /**
   * Pulls messages still sitting in the shared inbox for one chat, in bypass of
   * the live inbox subscription, for the user's "Force-refresh chat" action.
   *
   * Lists the inbox from the chat's last incoming message (incoming records
   * keep the delivery timestamp, which is the unit the listing reads) and runs
   * every matching message through the ordinary incoming path. Returns what the
   * listing held and how many new message records the chat gained.
   */
  forceRefreshChat(chatId: ChatIdObj): Promise<{ listed: number; applied: number }>;

  /**
   * Creates new one-to-one chat. In case of an error it throws quite soon.
   * When local data allows chat creation, this returns id of created chat.
   * New chat object is pushed in event, observable via watch() method.
   */
  createOneToOneChat(params: Pick<SingleChatView, 'peerAddr' | 'name'> & { ownName?: string }): Promise<ChatIdObj>;

  /**
   * Accepts chat invitation.
   * @param chatId
   * @param chatMessageId
   * @param ownName is a name one wants to use in the chat
   */
  acceptChatInvitation(chatId: ChatIdObj, chatMessageId: string, ownName: string): Promise<void>;

  /**
   * Creates new group chat. In case of an error it throws quite soon.
   * When local data allows chat creation, this returns id of created chat.
   * New chat object is pushed in event, observable via watch() method.
   * @param value contains parameters of a group chat.
   */
  createGroupChat(value: Pick<GroupChatView, 'chatId' | 'members' | 'name'>): Promise<ChatIdObj>;

  getChatList(): Promise<ChatListItemView[]>;

  renameChat(chatId: ChatIdObj, newName: string): Promise<void>;

  chatSetUp(chatId: ChatIdObj, data: Partial<ChatSettings>): Promise<void>;

  deleteChat(chatId: ChatIdObj): Promise<void>;

  updateGroupMembers(chatId: ChatIdObj, changes: UpdateMembersSysMsgData['value']): Promise<void>;

  updateGroupAdmins(chatId: ChatIdObj, changes: UpdateAdminsSysMsgData['value']): Promise<void>;

  getChat(chatId: ChatIdObj): Promise<ChatListItemView | undefined>;

  findChatEntry(chatId: ChatIdObj, throwIfMissing?: boolean): ChatDbEntry | undefined;

  deleteMessagesInChat(chatId: ChatIdObj, deleteForEveryone: boolean): Promise<void>;

  deleteMessage(id: ChatMessageId, deleteForEveryone: boolean): Promise<void>;

  /**
   * Deletion of a batch can succeed partly, so the caller is told which
   * messages are gone and which are still in the database.
   */
  deleteMessages(chatMsgIds: ChatMessageId[], deleteForEveryone: boolean): Promise<MsgsDeletionResult>;

  deleteExpiredMessages(now: number): Promise<void>;

  collectGarbageInAuxiliaryDB(): Promise<void>;

  removeExpiredInboxMessages(now: number): Promise<void>;

  resolveStuckSyncingSelfMessages(): Promise<void>;

  collectGarbageInSyncVersions(now: number): Promise<void>;

  /**
   * Hands journalled phantoms to delivery - those left by an earlier run of this
   * component, and those a failed pass left behind. Run at startup, by the retry
   * pass, and when a call ends (a call makes the release step aside). The result
   * tells the retry pass whether to try again - see sync-phantoms.ts.
   */
  releasePendingSyncPhantoms(): Promise<SyncPhantomReleaseResult>;

  /**
   * How many changes made on this device are recorded but not yet handed to
   * delivery. Anything but zero for long means the user's other devices are
   * behind this one.
   */
  countPendingSyncPhantoms(): Promise<number>;

  /**
   * How many phantoms are inside a delivery, waiting for its outcome. Together
   * with the count above this is the whole journal: recorded, on the way, done.
   * A number that never falls means the platform stopped reporting outcomes.
   */
  countSyncPhantomsInDelivery(): Promise<number>;

  /**
   * Current state of synchronization work, for the GUI indicator. Needed
   * alongside the events, because those are only built while a GUI is attached
   * (see emitChatEvent), and a start-up catch-up often finishes before that.
   */
  getSyncActivityState(): Promise<SyncActivityView>;

  /**
   * Asks the user's other devices to repeat the records that buffered orphaned
   * phantoms are still waiting for. Run once per session, on a delay after
   * startup and never while a call is on - a lost record's carrier does not
   * reappear by itself, but resync traffic shares ASMail delivery with call
   * signalling (see msg-resync.ts and the timer in src-deno/index.ts).
   */
  requestResyncForStuckOrphans(): Promise<void>;

  /**
   * Installs the "a call is going on" check that makes resync asks and answers
   * step aside (see ResyncCtx.isBusy). Called from startup wiring: the video
   * chat service, which owns the answer, starts after this service.
   */
  setResyncBusyCheck(isBusy: () => boolean): void;

  syncLocallyMadeSystemEvent(
    chatId: ChatIdObj,
    chatMessageId: string,
    chatSystemData: ChatSystemMessageData,
  ): Promise<void>;

  /**
   * Blocked addresses as this component knows them, canonical.
   *
   * Answered from the blacklist tracker, which is warm from its cache before
   * any RPC (see contacts-blacklist.ts), and exists so that the GUI need not
   * wait for the contacts app to come up to learn who is blocked. Empty when
   * the tracker has nothing yet.
   */
  getBlacklistedAddresses(): Promise<string[]>;
  getLatestIncomingMsgTimestamp(): number | undefined;

  getMessage(id: ChatMessageId): Promise<ChatMessageView | undefined>;

  getMessagesByChat(chatId: ChatIdObj): Promise<ChatMessageView[]>;

  /**
   * A page of the chat's history, newest first by default, in ascending order.
   * Pass the cursor of the oldest message already at hand to get the page
   * before it. hasMoreOlder tells whether anything precedes the returned page.
   */
  getMessagesPageByChat(
    chatId: ChatIdObj,
    opts: { limit: number; before?: MsgPageCursor },
  ): Promise<{ msgs: ChatMessageView[]; hasMoreOlder: boolean }>;

  getRecentReactions(quantity: number): Promise<string[]>;

  /**
   * Previews of this message's attachments that have already been made, by file
   * name. A Promise even though the database read is synchronous: everything
   * published on the IPC channel is wrapped in async by the facade.
   */
  getThumbnails(id: ChatMessageId): Promise<Record<string, string>>;
  /**
   * Keeps a preview for next time. Oversized ones are dropped rather than
   * stored: see THUMBNAIL_CACHE_MAX_CHARS.
   */
  saveThumbnail(id: ChatMessageId, fileName: string, dataUrl: string): Promise<void>;

  sendRegularMessage({
    chatId,
    chatMessageId,
    text,
    files,
    relatedMessage,
  }: {
    chatId: ChatIdObj;
    chatMessageId?: string;
    text: string;
    files: OutgoingAttachment[] | undefined;
    relatedMessage: RelatedMessage | undefined;
  }): Promise<void>;

  cancelSendingMessage(deliveryId: string, chatMsgId: ChatMessageId): Promise<void>;

  markMessageAsReadNotifyingSender(chatMessageId: ChatMessageId): Promise<void>;

  checkAddressExistenceForASMail(addr: string): Promise<AddressCheckResult>;

  // XXX will this be needed? Or, will this turn to get attachments thing?
  getIncomingMessage(msgId: string): Promise<ChatIncomingMessage | undefined>;

  watch(obs: web3n.Observer<UpdateEvent>): () => void;

  /**
   * Reports an incoming call system message ('outgoing-call-cancelled' /
   * 'incoming-call-cancelled') to another service in this process. Returns an
   * unsubscribe function.
   *
   * Deliberately not the same thing as watch(): that one is for the GUI, and it
   * only builds an event when someone is observing (see emitChatEvent in
   * chat-service/events.ts). A background subscription would make it observed
   * forever, so every chat event in the app would pay for assembling views and
   * summaries even with no window open.
   *
   * `chatId` is the receiving side's own view of the chat, resolved from the
   * database rather than taken from the message body: the sender puts its own
   * projection of a one-to-one chat there, which is this very user's address.
   *
   * `callSessionId` and `deliveryTS` are what the listener judges relevance by -
   * this message outlives the call it is about by days (see
   * admitsCallCancelSysMsg in video-chat-service/utils/call-state.ts).
   */
  onIncomingCallSysMsg(
    handler: (params: {
      chatId: ChatIdObj;
      sender: string;
      subType: WebRTCMsgBodySysMsgData['value']['subType'];
      /** Call the message is about; absent on builds that predate the field. */
      callSessionId?: string;
      /** When the message was delivered, for judging how stale it is. */
      deliveryTS: number;
    }) => void,
  ): () => void;

  updateEarlySentMessage({
    chatId,
    chatMessageId,
    updatedBody,
  }: {
    chatId: ChatIdObj;
    chatMessageId: string;
    updatedBody: string;
  }): Promise<ChatMessageView | undefined>;

  changeMessageReaction({
    chatId,
    chatMessageId,
    updatedReactions,
  }: {
    chatId: ChatIdObj;
    chatMessageId: string;
    updatedReactions: Record<string, ChatMessageReaction>;
  }): Promise<ChatMessageView | undefined>;

  sendSystemDeletableMessage({
    chatId,
    recipients,
    chatMessageId,
    chatSystemData,
  }: { chatId: ChatIdObj; recipients: string[] } & Pick<
    ChatSystemMsgV1,
    'chatMessageId' | 'chatSystemData'
  >): Promise<void>;

  /**
   * Everything the database side knows about an archive to be taken: the
   * records and the work-list of attachments. Attachment BYTES are not in it -
   * this app's window reaches the file store itself, so nothing of a file
   * crosses IPC (see doc/08-backup-and-restore.md §1).
   *
   * Flushes pending writes and takes the archive's HLC stamp before reading a
   * single row.
   */
  createBackupPlan(opts: { withAttachments?: boolean }): Promise<BackupPlan>;

  /** Stops a scan in progress. Only a backup is cancellable; a restore is not. */
  cancelBackupPlan(): Promise<void>;

  /**
   * A dry run over an archive that has already been read: the numbers the mode
   * dialog shows before the most destructive action in the whole feature.
   * Writes nothing.
   */
  previewRestore(recordFiles: BackupRecordFiles, mode: RestoreMode): Promise<RestorePreview>;

  /**
   * Applies an archive, and announces what it did to the user's other devices.
   *
   * `storedAttachments` maps an archive's blobName to the id the WINDOW created
   * when it wrote those bytes into the file store; the archived id is never
   * reused. `snapshotTs` comes from the archive's metadata - for an encrypted
   * archive the window is the only one that can read it.
   *
   * `unusedAttachmentIds` in the answer are the ids the aspect rules found no
   * use for; the window deletes them, or every restore would leave orphans in
   * the store.
   */
  restoreBackupArchive(params: {
    recordFiles: BackupRecordFiles;
    storedAttachments: Record<string, string>;
    mode: RestoreMode;
    snapshotTs?: number;
  }): Promise<RestoreOutcome>;

  makeAndSaveMsgToDb(ownAddr: string, msgData: Partial<MsgDbEntry>): Promise<ChatMessageView>;

  /**
   * makeAndSaveMsgToDb plus the phantom that carries the new record to the
   * user's other devices. For system records of a decision taken on this device
   * alone, which nothing else puts on the wire.
   *
   * `body` is built from `chatSystemData` here, so callers pass the event once.
   */
  saveAndSyncLocalSystemMsg(
    ownAddr: string,
    chatId: ChatIdObj,
    chatSystemData: ChatSystemMessageData,
    msgData: Partial<MsgDbEntry>,
  ): Promise<ChatMessageView>;
}

/**
 * What a window actually talks to: the service, plus `ping()`.
 *
 * `ping()` is a property of the channel rather than of the service, and the
 * split is the point. Every method of ChatSrv reaches the GUI through a facade
 * that awaits the real service (facadeOver in chat-service/ipc-expose.ts), so
 * none of them can answer while the service is still being built - or ever
 * again, if the component has stopped. `ping()` is answered from the
 * component's own state, which is what lets the GUI tell those two apart
 * instead of showing a spinner forever (2026-09-10).
 */
export interface ChatSrvOverIPC extends ChatSrv {
  ping(): Promise<ComponentStatus>;
  /**
   * Test stand only (see the guard in ipc-expose.ts): occupies a call for the
   * given time, so a spec can check that `ping` still answers while an
   * ordinary call is pending - the property the whole split rests on.
   */
  hangForTest?(millis: number): Promise<void>;
  /**
   * Test stand only: makes `ping` never answer, which is what a component
   * that has stopped looks like from a window.
   */
  stopPingForTest?(silenced: boolean): Promise<void>;
}
