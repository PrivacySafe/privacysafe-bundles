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
 * Checks of what peers put into message bodies.
 *
 * The sender of an ASMail message is vouched for by the platform; everything
 * in its JSON body is whatever that sender chose to write. A body that is
 * wrong in shape must not reach the database or the GUI, where it either
 * breaks the chat for good (an unknown auto-delete id threw on every message)
 * or is shown as something it is not. See the audit of 2026-11-26.
 *
 * Pure functions only, so that each rule is tested on its own
 * (ci/peer-input-checks.test.ts).
 */

import {
  AUTO_DELETE_MESSAGES_BY_ID,
  AUTODELETE_OFF,
  autoDeleteOptionIdOf,
  type AutoDeleteOptionId,
} from '../../../../shared-libs/constants/chat-settings.ts';
import { areAddressesEqual, checkAndTransformAddress } from '../../../../shared-libs/address-utils.ts';
import type { ChatMessageHistory, ChatMessageReaction } from '../../../../types/chat.types.ts';
import type { RecordedMediaInMsg, RelatedMessage } from '../../../../types/asmail-msgs.types.ts';

/** Longer chat names are cut, not refused: a name is a label, not data. */
export const MAX_CHAT_NAME_LENGTH = 200;

/** A group of more than this many people is not something a peer gets to claim. */
export const MAX_GROUP_MEMBERS = 1000;

/** Body of an edited message; generous, the composer itself has no lower limit. */
export const MAX_MSG_BODY_LENGTH = 1_000_000;

/** Entries of a message's history kept; older ones are dropped. */
export const MAX_HISTORY_CHANGES = 50;

const MAX_REACTION_NAME_LENGTH = 64;

// Control characters and line separators: none belong in a one-line name.
// eslint-disable-next-line no-control-regex
const controlChars = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/**
 * A chat name as it may be stored: a string, without control characters
 * (a newline in a name forges log lines and breaks one-line layouts), trimmed
 * and cut to a sane length. Anything that is not a string gives undefined.
 */
export function normalizeChatName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return;
  }
  const name = value.replace(controlChars, ' ').trim();
  return (name.length > MAX_CHAT_NAME_LENGTH) ? name.substring(0, MAX_CHAT_NAME_LENGTH) : name;
}

export function isAutoDeleteId(value: unknown): value is AutoDeleteOptionId {
  return (typeof value === 'string') && (autoDeleteOptionIdOf(value) === value);
}

/**
 * Auto-delete period of a settings id. An id this version does not know - one
 * stored before peers' settings were checked, or one of a newer version - is
 * "off": a wrong period would delete messages, an exception would stop the
 * chat from sending and receiving at all.
 */
export function autoDeleteValueOf(id: unknown): number {
  return isAutoDeleteId(id) ? AUTO_DELETE_MESSAGES_BY_ID[id].value : AUTODELETE_OFF;
}

/**
 * Settings a peer may set in a chat. Only the auto-delete period is a shared
 * setting; nothing else from the body is taken.
 */
export function peerSettingsOf(value: unknown): { autoDeleteMessages: AutoDeleteOptionId } | undefined {
  if (!value || (typeof value !== 'object')) {
    return;
  }
  const { autoDeleteMessages } = value as { autoDeleteMessages?: unknown };
  return isAutoDeleteId(autoDeleteMessages) ? { autoDeleteMessages } : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && (typeof value === 'object') && !Array.isArray(value);
}

/**
 * Members of a group as a peer sends them: a record keyed by valid addresses
 * with `{ hasAccepted: boolean }` values, of a sane size.
 */
export function isMembersRecord(value: unknown): value is Record<string, { hasAccepted: boolean }> {
  if (!isPlainRecord(value)) {
    return false;
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_GROUP_MEMBERS) {
    return false;
  }
  return entries.every(([addr, info]) => !!checkAndTransformAddress(addr)
    && isPlainRecord(info) && (typeof info.hasAccepted === 'boolean'));
}

export function isAddressList(value: unknown): value is string[] {
  return Array.isArray(value)
    && (value.length <= MAX_GROUP_MEMBERS)
    && value.every(addr => (typeof addr === 'string') && !!checkAndTransformAddress(addr));
}

/**
 * Key under which an address is kept in a members record. Records are keyed by
 * whatever form the address had when it got there, so a lookup by another
 * spelling of the same address (`members[addr]`) misses it.
 */
export function findMemberKey(members: Record<string, unknown> | null | undefined, addr: string): string | undefined {
  if (!members) {
    return;
  }
  if (Object.hasOwn(members, addr)) {
    return addr;
  }
  return Object.keys(members).find(key => areAddressesEqual(key, addr));
}

/**
 * A preview image a peer may attach to a recording: an inline raster image.
 * A URL would be fetched by the GUI as soon as the message is shown - a read
 * receipt and the victim's IP address for whoever runs the server.
 */
export function isInlineImageDataUrl(value: unknown): value is string {
  return (typeof value === 'string') && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]*$/.test(value);
}

export function isReaction(value: unknown): value is ChatMessageReaction {
  if (!isPlainRecord(value)) {
    return false;
  }
  const { type, name, color } = value;
  return (typeof name === 'string') && (name.length > 0) && (name.length <= MAX_REACTION_NAME_LENGTH)
    && ((type === undefined) || (type === 'emoji') || (type === 'icon'))
    && ((color === undefined) || ((typeof color === 'string') && /^[#a-zA-Z0-9(),.\s%-]{1,40}$/.test(color)));
}

/** Drops the oldest entries of a history beyond MAX_HISTORY_CHANGES. */
export function capHistory(history: ChatMessageHistory): ChatMessageHistory {
  const changes = history.changes ?? [];
  return (changes.length > MAX_HISTORY_CHANGES)
    ? { ...history, changes: changes.slice(changes.length - MAX_HISTORY_CHANGES) }
    : history;
}

/**
 * Recordings a peer describes in a message, kept only for attachments the
 * message really has, with a known kind, a sane duration, and a preview that is
 * an inline image. Keys are matched as own properties: an attachment named
 * 'toString' used to find a function in this record.
 */
export function checkedRecordings(
  recordings: unknown,
  attachmentNames: string[],
): Record<string, RecordedMediaInMsg> | undefined {
  if (!isPlainRecord(recordings)) {
    return;
  }
  const checked: Record<string, RecordedMediaInMsg> = {};
  for (const name of attachmentNames) {
    if (!Object.hasOwn(recordings, name)) {
      continue;
    }
    const rec = recordings[name];
    if (!isPlainRecord(rec)) {
      continue;
    }
    const { kind, durationMs, preview } = rec;
    if (((kind !== 'voice') && (kind !== 'video'))
      || (typeof durationMs !== 'number') || !Number.isFinite(durationMs) || (durationMs < 0)) {
      continue;
    }
    checked[name] = {
      kind,
      durationMs,
      ...(isInlineImageDataUrl(preview) && { preview }),
    };
  }
  return (Object.keys(checked).length > 0) ? checked : undefined;
}

function isChatIdObj(value: unknown): value is { isGroupChat: boolean; chatId: string } {
  return isPlainRecord(value) && (typeof value.isGroupChat === 'boolean')
    && (typeof value.chatId === 'string') && (value.chatId.length > 0);
}

/**
 * Chat records of a backup archive in a shape that can be stored, or undefined
 * for one that cannot. An archive is a file the user was handed: it gets the
 * same checks as a peer's invitation - names one-line and bounded, a known
 * auto-delete period, members and admins that are addresses.
 */
export function checkedBackedUpChat<T extends { chatId: unknown; record: unknown }>(chat: T): T | undefined {
  if (!isPlainRecord(chat) || !isChatIdObj(chat.chatId) || !isPlainRecord(chat.record)) {
    return;
  }
  const record = chat.record;
  if (record.isGroupChat !== chat.chatId.isGroupChat) {
    return;
  }
  if (record.isGroupChat && (!isMembersRecord(record.members) || !isAddressList(record.admins))) {
    return;
  }
  const settings = isPlainRecord(record.settings) ? record.settings : {};
  return {
    ...chat,
    record: {
      ...record,
      name: normalizeChatName(record.name) ?? '',
      settings: { ...settings, autoDeleteMessages: autoDeleteOptionIdOf(settings.autoDeleteMessages) },
    },
  };
}

export function isBackedUpMsgShape(msg: unknown): boolean {
  return isPlainRecord(msg) && isChatIdObj(msg.chatId)
    && (typeof msg.chatMessageId === 'string') && isPlainRecord(msg.record);
}

const MAX_REPLY_QUOTE_LENGTH = 2000;

/**
 * A reply or forward reference of a peer's message, in the shape the GUI
 * expects: strings of a sane length, nothing else. Who a forwarded message is
 * "from" stays the forwarder's word - forwarding is a claim by nature - but it
 * has to be an address.
 */
export function checkedRelatedMessage(value: unknown): RelatedMessage | undefined {
  if (!isPlainRecord(value)) {
    return;
  }
  const checked: RelatedMessage = {};
  const { replyTo, forwardFrom } = value;
  if (isPlainRecord(replyTo) && (typeof replyTo.chatMessageId === 'string') && replyTo.chatMessageId) {
    checked.replyTo = {
      chatMessageId: replyTo.chatMessageId,
      ...((typeof replyTo.displayedText === 'string')
        && { displayedText: replyTo.displayedText.substring(0, MAX_REPLY_QUOTE_LENGTH) }),
    };
  }
  if (isPlainRecord(forwardFrom) && (typeof forwardFrom.sender === 'string')
    && checkAndTransformAddress(forwardFrom.sender)) {
    checked.forwardFrom = { sender: forwardFrom.sender };
  }
  return (checked.replyTo || checked.forwardFrom) ? checked : undefined;
}
