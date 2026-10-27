/*
 Copyright (C) 2020 - 2025 3NSoft Inc.

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
  StoredInvitationParams,
  ChatIdObj,
  ChatMessageId,
  ChatSystemMessageData,
  ChatMessageType,
} from './asmail-msgs.types';
import type { AddressCheckResult } from './services.types.ts';
import type { ChatSettings } from '../src-deno/types/index.ts';
import type { RecordingKind } from '../shared-libs/constants/media-recording.ts';

export type ChatMenuAction =
  | 'chat:info'
  | 'chat:refresh'
  | 'chat:rename'
  | 'history:export'
  | 'history:clean'
  | 'chat:close'
  | 'chat:timer'
  | 'chat:delete'
  | 'contact:block'
  | 'contact:unblock'
  | 'contact:manage-blocks';

export interface ChatMenuItem {
  icon: string;
  action: string; // the composite action -> entity:action:value
  text: string;
  chatTypes: ('single' | 'group' | 'group&admin')[];
  disable?: ('chat-with-call' | 'incoming-call' | 'blocked-chat')[];
  isAccent?: boolean;
  margin?: boolean;
  subMenu?: ChatMenuItem[];
}

export interface ChatViewBase extends ChatIdObj {
  name: string;
  createdAt: number;
  lastUpdatedAt: number;
  callStart?: number;
  /**
   * Indicates whether a call is currently active in this chat room.
   * Set to true when heartbeat messages are received from other participants.
   * Used for re-join feature: shows "Join call" button when user is not in the call.
   */
  isCallActive?: boolean;
  incomingCall?: {
    chatId: ChatIdObj;
    peerAddress: string;
    /**
     * Session id the incoming-call command named. Echoed back on join/dismiss
     * so the background service can refuse a click armed for a call that is
     * already over.
     */
    callSessionId?: string;
  };
  settings: ChatSettings;
}

export interface SingleChatView extends ChatViewBase {
  isGroupChat: false;
  peerAddr: string;
  status: SingleChatStatus;
}

export type SingleChatStatus = 'initiated' | 'on' | 'invited' | 'accepted' | 'no-members';

export interface GroupChatView extends ChatViewBase {
  isGroupChat: true;
  members: Record<string, { hasAccepted: boolean }>;
  admins: string[];
  status: GroupChatStatus;
}

export type GroupChatStatus = 'initiated' | 'partially-on' | 'on' | 'invited' | 'accepted' | 'no-members';

export type ChatView = SingleChatView | GroupChatView;

export interface ChatMessageReaction {
  type?: 'emoji' | 'icon';
  name: string;
  color?: string;
}

export interface SerializedDeliveryError {
  message: string;
  type?: string;
  domainNotFound?: true;
  noServiceRecord?: true;
  unknownRecipient?: true;
  senderNotAllowed?: true;
  inboxIsFull?: true;
  badRedirect?: true;
  authFailedOnDelivery?: true;
  msgTooBig?: true;
  allowedSize?: number;
  recipientHasNoPubKey?: true;
  recipientPubKeyFailsValidation?: true;
  msgNotFound?: true;
  msgCancelled?: true;
}

export type ChatMessageHistoryErrors = Record<string, SerializedDeliveryError>;

export interface ChatMessageHistoryChange {
  user: string;
  timestamp: number;
  /**
   * 'unconfirmed-delivery': the delivery never reported completion and was
   * reconciled to 'sent' (see delivery-reconcile.ts); `value` is a text note.
   */
  type: 'body' | 'reaction' | 'error' | 'unconfirmed-delivery';
  value: string | Record<string, ChatMessageReaction> | ChatMessageHistoryErrors;
}

export interface ChatMessageHistory {
  changes?: ChatMessageHistoryChange[];
}

/**
 * What makes an attachment a recording made in this app rather than a file
 * picked from somewhere.
 *
 * `durationMs` is carried rather than read off the file because it cannot be
 * read off the file: WebM out of MediaRecorder has no Duration element, and
 * under MediaSource an element reports `Infinity` until endOfStream() - see
 * readDuration() in useAudioView.
 */
export interface AttachmentRecordingInfo {
  kind: RecordingKind;
  durationMs: number;
}

export interface ChatMessageAttachmentsInfo {
  id?: string;
  name: string;
  isFolder?: boolean;
  size: number;
  hasNoLocalSource?: boolean;
  originDeviceId?: string;
  /**
   * Set when this attachment was recorded in the app. Rides in the message
   * record's JSON, so it needs no column of its own and reaches the user's own
   * devices through the phantom's attachment list for free.
   */
  recording?: AttachmentRecordingInfo;
}

/**
 * A file or folder on its way into an outgoing message.
 *
 * A wrapper rather than the entity itself, so that what the GUI already knows
 * about the entity can travel with it. The IPC serializer walks the argument
 * graph to any depth, lifts platform objects out into passedByReference and
 * puts them back at the same place on the other side, so the entity survives
 * the trip while the fields beside it go as plain JSON. Writing those fields
 * onto the entity object instead would not work: the receiving side replaces
 * that object with the restored core one.
 */
export interface OutgoingAttachment {
  entity: web3n.files.ReadonlyFile | web3n.files.ReadonlyFS;
  /**
   * An item the GUI has already put into this app's file store, whose id
   * becomes the attachment's id as it is. Set only for a file pasted from the
   * clipboard: such a file has no existence outside this app to begin with, so
   * there is nothing to copy it from and nothing to link to - the bytes are
   * already stored, once.
   */
  storedId?: string;
  /**
   * The name the attachment should carry, when it is not the entity's own. A
   * stored item is named after its id, which is not a name to show anybody.
   */
  name?: string;
  /**
   * Set when this attachment was just recorded in the app.
   *
   * `preview` is here and not in AttachmentRecordingInfo because it does not
   * belong in the message record: previews live in their own table, and the
   * sending side puts this one there rather than into `attachments`.
   */
  recording?: AttachmentRecordingInfo & { preview?: string };
}

export interface ChatMessageViewBase {
  chatId: ChatIdObj;
  /**
   * chatMessageId is generated by sender. It should be unique within a chat.
   * Expected form is an epoch in 100's of seconds, dash, short random part,
   * e.g. `${Math.floor(Date.now()/(100*1000))}-${randomString}` yielding
   * something like 17469720-eAkJmPpW.
   * A ballpark epoch extractable from chatMessageId allows for more efficient
   * lookup in implementation of message storage/dataset.
   */
  chatMessageId: string;
  timestamp: number;
  isIncomingMsg: boolean;
  /**
   * incomingMsgId presence indicates that this is an incoming message, and its
   * value identifies message in the inbox, as it is generated by receiving
   * ASMail server.
   * Database needs to know if message is incoming, but actual id value is
   * needed only when there are bytes in inbox, like with attachments.
   * Otherwise, message can be removed and id's value isn't needed.
   */
  incomingMsgId?: web3n.asmail.IncomingMessage['msgId'];
  sender: string;
}

export interface RegularMsgView extends ChatMessageViewBase {
  /**
   * chatMessageType indicates type of message
   */
  chatMessageType: 'regular';
  /**
   * relatedMessage reference other chat message.
   */
  relatedMessage?: {
    replyTo?: {
      chatMessageId: string;
      displayedText?: string;
    };
    forwardFrom?: {
      sender: string;
    };
    msgNotFound?: true;
  };
  body: string;
  status: MessageStatus;
  attachments?: ChatMessageAttachmentsInfo[];
  history?: ChatMessageHistory;
  reactions?: Record<string, ChatMessageReaction>;
  removeAfter: number;
  settings: ChatSettings;
}

export interface ChatSysMsgView extends ChatMessageViewBase {
  /**
   * chatMessageType indicates type of message
   */
  chatMessageType: 'system';
  systemData: ChatSystemMessageData;
  status?: undefined;
}

export interface ChatInvitationMsgView extends ChatMessageViewBase {
  /**
   * chatMessageType indicates type of message
   */
  chatMessageType: 'invitation';
  inviteData: StoredInvitationParams;
  status?: undefined;
}

export type ChatMessageView = RegularMsgView | ChatSysMsgView | ChatInvitationMsgView;

/**
 * Position in a chat's history, used to ask for the page preceding it.
 * Both fields are needed: timestamps come from Date.now() and are not unique,
 * so a message sharing a millisecond with the one on a page boundary would fall
 * out of the paging otherwise.
 */
export type MsgPageCursor = Pick<ChatMessageView, 'timestamp' | 'chatMessageId'>;

/**
 * Outcome of a bulk deletion of messages.
 *
 * Deletion of one message is several steps (a database row, an inbox message,
 * attachment files), so a batch can succeed partly. The caller gets both lists
 * because only the deleted ones are gone from the database, while the failed
 * ones are still there and still shown.
 */
export interface MsgsDeletionResult {
  deleted: ChatMessageId[];
  failed: ChatMessageId[];
}

export type IncomingMessageStatus = 'read' | 'unread';

export type OutgoingMessageStatus =
  'ready_to_send' | 'sending' | 'syncing_self' | 'sent' | 'error' | 'canceled' | 'read';

export type MessageStatus = IncomingMessageStatus | OutgoingMessageStatus;

export type ChatMessageActionType =
  | 'reaction'
  | 'reply'
  | 'copy'
  | 'forward'
  | 'edit'
  | 'download'
  | 'resend'
  | 'select'
  | 'info'
  | 'delete_message'
  | 'cancel_sending';

export interface ChatMessageAction {
  id: ChatMessageActionType;
  icon: {
    name: string;
    horizontalFlip?: boolean;
    rotateIcon?: 1 | 2 | 3;
  };
  title: string;
  conditions: string[];
  allowInReadonlyMode?: boolean;
  blockStart?: boolean;
  accent?: string;
  disabled?: boolean;
}

export type ChatListItemView = ChatView & {
  unread: number;
  lastMsg?: ChatMessageView | null;
};

/**
 * Chat list item as list views consume it. Both extra fields are properties of
 * the list as a whole, not of a single record, hence they are computed once,
 * where the list is assembled:
 * - `displayName` is the name to show (a one-to-one chat may have none of its
 *   own and fall back to the contact name);
 * - `isNameDuplicated` says that some other chat in the list shows the very same
 *   name, so the item has to add something that tells them apart. Chat names are
 *   not unique by design: two group chats may share a name (and even members),
 *   and two contacts may share a display name.
 */
export type ChatListItemUiView = ChatListItemView & {
  displayName: string;
  isNameDuplicated: boolean;
};

export interface ChatException extends web3n.RuntimeException {
  type: 'chat';
  failedAddresses?: {
    addr: string;
    check?: AddressCheckResult;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exc?: any;
  }[];
}

export interface LocalMetadataInDelivery {
  chatId: ChatIdObj;
  chatMessageId?: ChatMessageView['chatMessageId'];
  chatMessageType: ChatMessageType;
  chatSystemData?: ChatSystemMessageData;
  isDeletable?: boolean;
  /**
   * Which row of the outgoing-phantom journal this delivery carries.
   *
   * Diagnostics only - it makes a log line and a `listMsgs()` dump name the
   * change. Settling a row is always decided by the in-memory flight registry
   * (phantom-flight.ts) and never by this field: a row id from a previous run of
   * the component would point at a row that has since been released again.
   */
  syncJournalRowId?: number;
}
