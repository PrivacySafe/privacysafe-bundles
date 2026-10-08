/*
 Copyright (C) 2024-2025 3NSoft Inc.

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
import type { Nullable } from '@v1nt1248/3nclient-lib';

export interface MailFolder {
  id: string;
  name: string;
  icon?: Nullable<string>;
  iconColor?: Nullable<string>;
  position: number;
  path: string;
  isSystem: boolean;
}

export interface MailFolderDB {
  id: string;
  name: string;
  icon: Nullable<string>;
  iconColor: Nullable<string>;
  position: number;
  path: string;
  isSystem: number;
}

// export type DbQueryParams<T, K extends string & keyof T> = {
//   [p in `$${K}`]: T[K];
// };
export type DbQueryParams<T, K extends string & keyof T> = Record<`$${K}`, T[K]>;

export type MessageDeliveryStatus = 'draft' | 'sending' | 'sent' | 'error' | 'canceled' | 'received' | 'read';

export interface MessageDeliveryInfo {
  msgId: string;
  status: MessageDeliveryStatus;
  value: string | number;
}

export interface SendingMessageStatus {
  msgId?: string;
  status: web3n.asmail.DeliveryProgress | undefined;
  info: MessageDeliveryInfo | undefined;
}

export type MessageKind = 'regular' | 'system';

export interface MessageJsonBody {
  threadId: string;
  msgKind: MessageKind;
}

export interface IncomingMessage extends web3n.asmail.IncomingMessage {
  jsonBody: Partial<MessageJsonBody>;
}

export interface OutgoingMessage extends web3n.asmail.OutgoingMessage {
  jsonBody: Partial<MessageJsonBody>;
}

export interface AttachmentInfo {
  /**
   * id in the file store, or a handle of a file held for this session.
   *
   * Absent when there are no bytes on this device at all: the record came in a
   * phantom from another device, and an id from there points into another
   * device's file store. Optional on purpose - that way "the file is not here"
   * cannot be expressed as a valid id, and the compiler finds the places where
   * an id was used without a check.
   */
  id?: string;
  fileName: string;
  size: number;
  /** 'origin' marks an attachment of an incoming message: it lives in that message, not in the store. */
  type?: string;
  /**
   * The incoming message an `origin` attachment lives in. Set when such a record
   * is carried into a forward, where `id` no longer says which message to look
   * in — the record's own message is the forward by then.
   */
  originMsgId?: string;
  /**
   * The bytes were never copied: `id` is a store item that only references a file
   * on this device. Set for attachments above ATTACHMENT_COPY_THRESHOLD, which
   * are read from their original place when the message is packed.
   *
   * Unlike a copy, such an attachment is only as good as the user's own file: it
   * stops resolving once that file is moved, renamed or deleted.
   */
  external?: true;
  /**
   * There are no bytes for this attachment on this device: it was attached on
   * another device of the user, and only the record travelled here.
   *
   * The single flag availability is decided by - see attachmentAvailabilityOf().
   */
  hasNoLocalSource?: true;
  /** The device the file is attached on. For logs and for what the user is told. */
  originDeviceId?: string;
}

export interface PreparedMessageData {
  id: string;
  threadId: string;
  recipients: string[];
  subject: string;
  attachmentsInfo?: AttachmentInfo[];
  plainTxtBody?: string;
  htmlTxtBody?: string;
}

export interface MessageExtraInfo {
  threadId: string;
  cTime?: number;
  status: MessageDeliveryStatus;
  statusDescription?: Record<string, string>;
  mailFolder: string;
  attachmentsInfo?: AttachmentInfo[];
  /**
   * The device this record was created on.
   *
   * Needed apart from the per-attachment flag: a synchronized record with
   * status 'sending' would otherwise show "cancel / retry" on another device,
   * where pressing cancel would send a *false* 'canceled' back to the sending
   * device and cancel nothing at all.
   *
   * Not an aspect and not part of the diff: it is a local fact about origin,
   * the same on every device by virtue of coming from one phantom. Absent on
   * records from before this column existed, which reads as "origin unknown".
   */
  originDeviceId?: string;
}

export type IncomingMessageView = Omit<IncomingMessage, 'establishedSenderKeyChain' | 'attachments'> &
  MessageExtraInfo & { msgId: string; isIncomingMessage?: boolean };

export type OutgoingMessageView = Omit<OutgoingMessage, 'attachments'> &
  MessageExtraInfo & {
    msgId: string;
    deliveryTS: number;
    isIncomingMessage?: boolean;
  };

export interface MessageThread {
  threadId: string;
  isExpanded?: boolean;
  folders: string[];
  lastIncomingTS: number;
  lastOutgoingTS: number;
  messages: (IncomingMessageView | OutgoingMessageView)[];
}

export interface MessageViewDB {
  msgId: string;
  cTime: Nullable<number>;
  msgType: string; // 'chat' | 'mail'
  deliveryTS: Nullable<number>;
  subject: Nullable<string>;
  plainTxtBody: Nullable<string>;
  htmlTxtBody: Nullable<string>;
  threadId: string;
  jsonBody: string;
  recipients: Nullable<string>;
  sender: Nullable<string>;
  mailFolder: string;
  status: Nullable<string>; // 'draft' | 'sending' | 'sent' | 'error' | 'canceled'
  statusDescription: Nullable<string>;
  attachmentsInfo: Nullable<string>;
  originDeviceId: Nullable<string>;
}

export type MessageAction =
  | 'move-to-trash'
  | 'delete'
  | 'edit'
  | 'send'
  | 'mark-as-read'
  | 'reply'
  | 'reply-all'
  | 'forward'
  | 'restore'
  | 'discard'
  | 'cancel'
  | 'block'
  | 'unblock'
  | 'report';

export type MessageBulkActions = 'select-all' | 'deselect-all' | 'cancel' | 'move-to-trash' | 'delete' | 'restore';
