/*
 Copyright (C) 2025 3NSoft Inc.

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
import { ChatMessageView } from '../types/chat.types.ts';
import { ChatIdObj } from '../types/asmail-msgs.types.ts';
import { generateFastRandomString } from './generate-random-string.ts';

export function chatIdToString({ isGroupChat, chatId }: ChatIdObj): string {
  return `${isGroupChat ? 'g' : 's'}/${chatId}`;
}

export function stringToChatId(idStr: string): ChatIdObj {
  // Only the two-character prefix that chatIdToString() puts in front is cut:
  // the rest is the id itself and may contain slashes
  if (idStr.startsWith('g/')) {
    return { isGroupChat: true, chatId: idStr.substring(2) };
  } else if (idStr.startsWith('s/')) {
    return { isGroupChat: false, chatId: idStr.substring(2) };
  } else {
    throw new Error(`String ${idStr} can't be parsed to ChatId object`);
  }
}

export function areChatIdsEqual(
  a: ChatIdObj | null | undefined, b: ChatIdObj,
): boolean {
  return (a ?
      (a.isGroupChat === b.isGroupChat) && (a.chatId === b.chatId) :
      false
  );
}

export function generateChatMessageId(): Pick<
  ChatMessageView, 'timestamp' | 'chatMessageId'
> {
  const timestamp = Date.now();
  return {
    timestamp,
    chatMessageId: `${Math.floor(timestamp / 1000)}-${generateFastRandomString(10)}`,
  };
}

/**
 * Id of a chat record that several devices of one user write for the same call
 * event, derived from the event instead of generated locally.
 *
 * Every device that answers or declines a call writes its own history record
 * for it, and each of those records is synchronized to the rest. With a locally
 * generated id the copies are different records, so answering on two devices
 * left two lines about one call - and the duration, synchronized as an
 * `update:body` naming one of the ids, could only ever land on one of them
 * (live run of 2026-08-15). The id being equal is what collapses them: the
 * receiving side already skips a record it has (see the 'call'/'webrtc-call'
 * branch in handle-incoming-sync.ts).
 *
 * `callSessionId` is the right source: it is `<hostAddr>#<appDeviceId>-<counter>`
 * (see nextCallSessionId), minted by the host and echoed by everyone, so it is
 * identical on every device and distinguishes this call both from the previous
 * one in the same chat and from one hosted by another device of the same user.
 *
 * `kind` keeps records that can coexist for one session apart - the call
 * itself, the decline of it, the caller's withdrawal of it - because the id is
 * part of the messages table's primary key. `by` does the same for the several
 * records one session can produce from different people: in a group call two
 * members declining the same call are two lines, and with the address left out
 * of the id the second one would be dropped as a record already there.
 *
 * `by` is the address the record itself names as `sender`, not the device that
 * writes it. That is what makes the id agree across our own devices - which is
 * the whole point - while still telling one person's decline from another's.
 *
 * Writers must treat a record with this id as possibly already there: a re-join
 * of the same session, or a phantom of another device arriving first, reaches
 * the same id, and the insert is a bare INSERT.
 *
 * The session id is base64url-encoded rather than pasted in, because a
 * chatMessageId does not stay inside the database. It is embedded in the ASMail
 * delivery id (see generateOutgoingMsgId), which the platform turns into a
 * folder name and which rejects `/` and `.` outright - and `.` is in every
 * domain name, which is what broke the decline in the live run of 2026-08-15.
 * It is also pasted into a CSS selector by the message list's Teleport target
 * (`#msg-<id>` in chat-messages.vue), where `:` and `@` are illegal too.
 * base64url is the alphabet that satisfies both, and being reversible it keeps
 * distinct sessions distinct by construction. Anything derived from an event
 * here must stay inside [A-Za-z0-9_-].
 */
export function chatMessageIdForCallEvent(
  kind: 'call' | 'call-cancelled' | 'call-withdrawn' | 'call-collision-failed',
  callSessionId: string,
  by?: string,
): string {
  const sessionPart = base64urlOf(callSessionId);
  return by
    ? `${kind}-${sessionPart}-${base64urlOf(by)}`
    : `${kind}-${sessionPart}`;
}

/**
 * The address of the device that hosts a call session, read out of its id.
 *
 * The only part of a callSessionId anything is allowed to parse: nextCallSessionId
 * puts the host's address in front of the first `#` and keeps whatever it needs
 * for uniqueness behind it. Returns undefined for an id of a shape this build
 * does not recognize, so callers fall back on knowing nothing rather than on a
 * wrong address.
 */
export function hostAddrOfCallSession(
  callSessionId: string | undefined,
): string | undefined {
  if (!callSessionId) {
    return undefined;
  }
  const sepPos = callSessionId.indexOf('#');
  return (sepPos > 0) ? callSessionId.substring(0, sepPos) : undefined;
}

/**
 * base64url of a string's UTF-8 bytes: the standard alphabet with `+/` swapped
 * for `-_` and the padding dropped, so the result is safe as a file name, as a
 * URL part and as a CSS identifier.
 */
export function base64urlOf(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Characters that may appear in a delivery id. The platform's own rule is
 * narrower - it rejects only `/` and `.` when making a folder for the message
 * (idToMsgFolder in core's asmail/delivery) - but the id is a path component,
 * so the safe set is the one that cannot mean anything to a file system.
 */
const UNSAFE_IN_DELIVERY_ID = /[^A-Za-z0-9_-]/g;

/**
 * Id of an outgoing ASMail delivery. When a chatMessageId is given it becomes
 * part of the id, so that a delivery can be told from the record it carries.
 *
 * That id is a folder name on the platform's side, and the strings reaching
 * here are not all ours: a record id can be derived from an event (see
 * chatMessageIdForCallEvent), and the acceptance of an invitation echoes back
 * the chatMessageId that came *from the peer*. Sanitizing here rather than at
 * each of the senders is deliberate - this function exists to produce the id
 * that goes to the platform, so it is the one place that has to know what the
 * platform will accept. For ids from generateChatMessageId this is a no-op.
 *
 * The timestamp stays in front, untouched, because that is what
 * creationTsFromDeliveryId reads back when reconciling deliveries.
 */
export function generateOutgoingMsgId(chatMessageId?: string, prefix?: string): string {
  const idPart = (chatMessageId || generateFastRandomString(16))
    .replace(UNSAFE_IN_DELIVERY_ID, '_');
  return `${prefix ?? ''}${Date.now()}_${idPart}`;
}
