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
import dayjs from 'dayjs';
import get from 'lodash/get';
import { useContactsStore } from '@main/common/store/contacts.store';
import { useAppStore } from '@main/common/store/app.store';
import { AUTO_DELETE_MESSAGES_BY_ID } from '@shared/constants';
import { callCancelWording } from '@shared/call-record-wording';
import { toCanonicalAddress } from '@shared/address-utils';
import {
  AttachmentRecordingInfo,
  ChatListItemView,
  ChatListItemUiView,
  ChatMessageAttachmentsInfo,
  ChatSysMsgView,
  ChatInvitationMsgView,
  OneToOneChatParameters,
  SingleChatView,
  GroupChatView,
  SingleChatStatus,
  GroupChatStatus,
  CallMsgBodySysMsgData,
  WebRTCMsgBodySysMsgData,
  ContactBlockedSysMsgData,
  ContactUnblockedSysMsgData,
  UpdatedChatSettingsSysMsgData,
} from '~/index';
import type { RecordingKind } from '@shared/constants/media-recording';

export interface ChatBlockingState {
  /** Blocked participants of the chat, as canonical addresses, never the user's own. */
  blockedMembers: string[];
  /**
   * Everyone else in this chat is blocked, so there is nobody left to write to.
   *
   * False for a chat with no other participants at all: an emptied group is
   * closed for other reasons (`no-members`), and calling that "all blocked"
   * would be a statement about nobody.
   */
  allOthersBlocked: boolean;
}

type ChatForBlocking =
  | Pick<GroupChatView, 'isGroupChat' | 'members'>
  | Pick<SingleChatView, 'isGroupChat' | 'peerAddr'>;

/**
 * Translation is passed in rather than taken with useI18n() here, and must be:
 * these functions are called from computed properties, which Vue also
 * evaluates from its scheduler, where there is no current instance and
 * useI18n() throws "Must be called at the top of a `setup` function".
 */
export type TranslateFn = (key: string, placeholders?: Record<string, string>) => string;

/**
 * Who in this chat is blocked, and whether that is everybody but the user.
 *
 * Both answers come from one function because they are read off the same list
 * and must agree: the mark on the avatar and the ban on typing are two sides
 * of the same fact.
 *
 * `isBlacklisted` is passed in rather than taken from the store here, so that
 * callers already holding it (a list item rendering many chats, say) do not
 * each reach for the store again.
 */
export function chatBlockingStateOf(
  chat: ChatForBlocking,
  isBlacklisted: (mail: string) => boolean,
  ownAddr: string | undefined,
): ChatBlockingState {
  const others = otherParticipantsOf(chat, ownAddr);
  const blockedMembers = others.filter(addr => isBlacklisted(addr));

  return {
    blockedMembers,
    allOthersBlocked: others.length > 0 && blockedMembers.length === others.length,
  };
}

function otherParticipantsOf(chat: ChatForBlocking, ownAddr: string | undefined): string[] {
  if (chat.isGroupChat) {
    const members = (chat as GroupChatView).members ?? {};
    const ownCAddr = ownAddr ? toCanonicalAddress(ownAddr) : undefined;
    return Object.keys(members)
      .map(addr => toCanonicalAddress(addr))
      .filter(addr => addr !== ownCAddr);
  }

  const peerAddr = (chat as SingleChatView).peerAddr;
  return peerAddr ? [toCanonicalAddress(peerAddr)] : [];
}

/**
 * The icon marking a chat with blocked participants, or undefined when it has
 * none.
 *
 * Two icons rather than one, because one would be saying different things. A
 * padlock means the whole chat is shut: nothing can be written into it. That is
 * true of a one-to-one chat with a blocked peer, and equally true of a group in
 * which every other member is blocked. A group with only some of them blocked
 * is still a chat the user writes in, so it gets an information mark instead,
 * meaning "somebody here is blocked".
 *
 * Deliberately not keyed off `readonly`: that is also raised for a chat not yet
 * accepted, or one left by everybody, which has nothing to do with blocking.
 */
export function blockingIconFor({
  blockedMembers,
  allOthersBlocked,
}: ChatBlockingState): 'round-lock' | 'round-info' | undefined {
  if (blockedMembers.length === 0) {
    return undefined;
  }
  return allOthersBlocked ? 'round-lock' : 'round-info';
}

export function getChatName(chat: ChatListItemView): string {
  const { name, isGroupChat } = chat;
  const { getContactName } = useContactsStore();

  return isGroupChat ? name || 'Untitled' : name ? name : getContactName(chat.peerAddr);
}

/**
 * Chat names are not unique: two group chats may carry the same name (even with
 * the same members), and two contacts may share a display name. Where a name is
 * shared with another chat in the list, this gives the text that tells them
 * apart - the peer's address for a one-to-one chat, and the creation date for a
 * group chat, which neither address nor member list can distinguish. For a name
 * that is unique in the list, an empty string.
 */
export function getChatNameHint(t: TranslateFn, chat: ChatListItemUiView): string {
  if (!chat.isNameDuplicated) {
    return '';
  }
  return chat.isGroupChat
    ? t('chat.list.item.created_at', { date: dayjs(chat.createdAt).format('DD MMM YYYY') })
    : chat.peerAddr;
}

export function getTextForChatSystemMessage(
  t: TranslateFn,
  message: ChatSysMsgView,
  isGroupChat: boolean,
  ownAddr?: string,
): string {
  const { getContactName } = useContactsStore();
  const appStore = useAppStore();

  const { sender, systemData, isIncomingMsg } = message;
  const { event } = systemData;

  switch (event) {
    case 'accept:invitation': {
      const acceptedSender = get(systemData, ['value', 'sender'], '');
      return t('chat.invitation.message.default.accepted', { name: acceptedSender || sender });
    }

    case 'update:chatName': {
      const text = t('chat.system_message.rename_chat');
      const msgSender = isIncomingMsg ? sender : appStore.user!;
      return `${text} ${getContactName(msgSender)}`;
    }

    case 'update:settings': {
      const { settings = {} } = (systemData as UpdatedChatSettingsSysMsgData).value;
      const autoDeleteMessageId = (settings?.autoDeleteMessages || '0') as '0' | '1' | '2' | '3' | '4' | '5';
      const timerValueText: string = t(AUTO_DELETE_MESSAGES_BY_ID[autoDeleteMessageId].label);

      switch (autoDeleteMessageId) {
        case '1':
        case '2':
        case '3':
        case '4':
          return !sender || sender === ownAddr
            ? t('chat.messages.info_message.autodelete.set_you', { value: timerValueText })
            : t('chat.messages.info_message.autodelete.set_user', {
                user: sender,
                value: timerValueText,
              });
        case '0':
        default:
          return !sender || sender === ownAddr
            ? t('chat.messages.info_message.autodelete.unset_you')
            : t('chat.messages.info_message.autodelete.unset_user', { user: sender });
      }
    }

    case 'member-left': {
      const memberWhoLeft = get(systemData, ['value', 'sender'], '');
      return t('chat.system_message.member_left', { member: memberWhoLeft || sender });
    }

    case 'member-removed': {
      const { chatDeleted } = systemData;
      return chatDeleted
        ? t('chat.system_message.chat_deleted', { admin: sender })
        : t('chat.system_message.you_are_removed', { admin: sender });
    }

    case 'update:members': {
      const {
        value: { membersAfterUpdate, membersToAdd, membersToDelete },
      } = systemData;

      if (Object.keys(membersToDelete).length > 0 && Object.keys(membersToDelete).includes(ownAddr!)) {
        return t('chat.system_message.remove_me', { admin: sender || '' });
      }

      if (Object.keys(membersToDelete).length > 0 && Object.keys(membersToAdd).length > 0) {
        return t('chat.system_message.add_and_remove_members', {
          admin: sender || ownAddr || '',
          membersToAdd: Object.keys(membersToAdd).join(', '),
          membersToDelete: Object.keys(membersToDelete).join(', '),
          participantsNum: `${Object.keys(membersAfterUpdate).length}`,
        });
      }

      if (Object.keys(membersToDelete).length > 0 && Object.keys(membersToAdd).length === 0) {
        return t('chat.system_message.remove_members', {
          admin: sender || ownAddr || '',
          membersToDelete: Object.keys(membersToDelete).join(', '),
          participantsNum: `${Object.keys(membersAfterUpdate).length}`,
        });
      }

      if (Object.keys(membersToDelete).length === 0 && Object.keys(membersToAdd).length > 0) {
        return t('chat.system_message.add_members', {
          admin: sender || ownAddr || '',
          membersToAdd: Object.keys(membersToAdd).join(', '),
          participantsNum: `${Object.keys(membersAfterUpdate).length}`,
        });
      }

      return '';
    }

    case 'update:admins': {
      const {
        value: { adminsToAdd = [], adminsToDelete = [] },
      } = systemData;

      if (adminsToDelete.length > 0 && adminsToAdd.length > 0) {
        return t('chat.system_message.add_and_remove_admins', {
          admin: sender || ownAddr || '',
          adminsToDelete: adminsToDelete.join(', '),
          adminsToAdd: adminsToAdd.join(', '),
        });
      }

      if (adminsToDelete.length > 0 && adminsToAdd.length === 0) {
        return t('chat.system_message.remove_admins', {
          admin: sender || ownAddr || '',
          adminsToDelete: adminsToDelete.join(', '),
        });
      }

      if (adminsToDelete.length === 0 && adminsToAdd.length > 0) {
        return t('chat.system_message.add_admins', {
          admin: sender || ownAddr || '',
          adminsToAdd: adminsToAdd.join(', '),
        });
      }

      return '';
    }

    case 'call': {
      const { sender, direction } = systemData.value as CallMsgBodySysMsgData['value'];
      return direction === 'incoming' ? t('va.text.incoming_call', { sender }) : t('va.text.outgoing_call');
    }

    case 'contact:blocked': {
      const { mail } = systemData.value as ContactBlockedSysMsgData['value'];
      // getContactName falls back to the address itself, which is exactly what
      // is wanted for somebody who is not in the address book under a name.
      return `${t('chat.contact.notification.blocked.part1', { name: getContactName(mail) })} `
        + `${t('chat.contact.notification.blocked.part2')}`;
    }

    case 'contact:unblocked': {
      const { mail } = systemData.value as ContactUnblockedSysMsgData['value'];
      return t('chat.contact.notification.unblocked', { name: getContactName(mail) });
    }

    case 'webrtc-call': {
      const { sender: byUser, subType, callSessionId } =
        systemData.value as WebRTCMsgBodySysMsgData['value'];
      // Which way the cancelled call went is decided by the session's host, not
      // by isIncomingMsg: these records are written locally on every device of
      // ours, so that flag is always false here (see callCancelWording).
      const { i18nKey } = callCancelWording(subType, callSessionId, ownAddr, isGroupChat);
      // Both placeholder names: the keys this returns name the person either as
      // {sender} or as {user}, and the unused one is simply not substituted.
      return t(i18nKey, { sender: byUser, user: byUser });
    }

    default:
      return '';
  }
}

export function getTextForChatInvitationMessage(
  t: TranslateFn,
  message: ChatInvitationMsgView,
  chatStatus?: SingleChatStatus | GroupChatStatus,
): string {
  const { sender, inviteData, isIncomingMsg, groupSender } = message as ChatInvitationMsgView & {
    groupSender?: string;
  };

  switch (inviteData.type) {
    case 'oto-chat-invite': {
      if (isIncomingMsg) {
        const { neverContactedInitiator } = inviteData;
        return neverContactedInitiator
          ? chatStatus === 'invited'
            ? t('chat.invitation.message.oto.incoming_from_unknown', { sender })
            : t('chat.invitation.message.oto.accepted_from_unknown', { sender })
          : chatStatus === 'invited'
            ? t('chat.invitation.message.oto.incoming', { sender })
            : t('chat.invitation.message.oto.accepted', { sender });
      }

      return t('chat.invitation.message.oto.sent');
    }

    case 'group-chat-invite': {
      const appStore = useAppStore();
      const members = Object.keys(inviteData.members!)
        .filter(m => m !== appStore.user)
        .join(', ');
      if (isIncomingMsg) {
        const { neverContactedInitiator } = inviteData;
        return neverContactedInitiator
          ? chatStatus === 'invited'
            ? t('chat.invitation.message.group.incoming_from_unknown', {
                sender: sender || groupSender || '',
              })
            : t('chat.invitation.message.group.accepted_from_unknown', {
                sender: sender || groupSender || '',
              })
          : chatStatus === 'invited'
            ? t('chat.invitation.message.group.incoming', { sender: sender || groupSender || '' })
            : t('chat.invitation.message.group.accepted', {
                sender: sender || groupSender || '',
              });
      }

      return t('chat.invitation.message.group.sent', { members });
    }

    default: {
      const { groupChat, oneToOneChat } = inviteData;
      const { name } = oneToOneChat || ({} as OneToOneChatParameters);
      if (isIncomingMsg) {
        if (oneToOneChat) {
          return t('chat.invitation.message.default.accepted', { name });
        }

        if (groupChat) {
          return t('chat.invitation.message.default.accepted', { name: sender });
        }

        throw new Error(`This message should've been rejected`);
      }

      return t('chat.invitation.message.default.sent');
    }
  }
}

/**
 * i18n key naming a recording made in the app.
 *
 * A recording is attached under a generated name (`voice_26-09-09_15-12.weba`),
 * which says nothing to anybody - so wherever an attachment would be named,
 * a recording is named by what it is instead. One place for the mapping,
 * because four of them need it: the chip, the chat list, a reply's excerpt and
 * the composer's caption.
 */
export function recordingLabelKey(kind: RecordingKind): string {
  return (kind === 'voice') ? 'chat.recording.label.voice' : 'chat.recording.label.video';
}

/**
 * What a message consisting of a recording reads as in a one-line excerpt:
 * "Voice message 00:03".
 */
export function recordingExcerpt(
  { kind, durationMs }: AttachmentRecordingInfo,
  t: (key: string) => string,
): string {
  return `${t(recordingLabelKey(kind))} ${timeInSecondsToString(Math.round(durationMs / 1000))}`;
}

/**
 * The recording among a message's attachments, if the message is one.
 *
 * Decided by the marker and never by the file's extension: an ordinary audio
 * file someone attached is not a voice message, and an older correspondent's
 * build sends recordings without the marker at all - both must keep showing as
 * plain attachments.
 */
export function recordingOfAttachments(
  attachments: ChatMessageAttachmentsInfo[] | undefined,
): AttachmentRecordingInfo | undefined {
  if (!attachments || (attachments.length !== 1)) {
    return undefined;
  }
  return attachments[0].recording;
}

export function timeInSecondsToString(timeInSeconds: number): string {
  let remainder = timeInSeconds;
  const hours = remainder > 3600 ? `${Math.floor(remainder / 3600)}` : 0;
  remainder = remainder % 3600;
  const minutes = `${Math.floor(remainder / 60)}`;
  const seconds = `${Math.floor(remainder % 60)}`;
  const str = `${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
  return hours === 0 ? str : `${hours.padStart(2, '0')}:${str}`;
}
