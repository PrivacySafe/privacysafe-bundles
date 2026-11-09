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
import type { ChatIdObj } from '../../../types/asmail-msgs.types.ts';
import type { GroupChatView, SingleChatView } from '../../../types/chat.types.ts';
import { includesAddress } from '../../../shared-libs/address-utils.ts';
import { ensureAllAddressesExist } from '../../utils/address-checks.ts';
import type { ChatSrvCtx } from './chat-srv-ctx.ts';
import type { IncomingMessages } from './incoming-messages.ts';

/**
 * Creation of chats by the user, and acceptance of an invitation.
 *
 * The receiving side is passed in rather than imported: accepting an
 * invitation has to pick up what the chat skipped while it could not receive.
 */
export function makeChatEntry(
  ctx: ChatSrvCtx,
  { canReceiveInChat, catchUpChatOpenedForReceiving }: Pick<
    IncomingMessages,
    'canReceiveInChat' | 'catchUpChatOpenedForReceiving'
  >,
) {
  const { chatCreation } = ctx;

  async function createOneToOneChat(
    params: Pick<SingleChatView, 'peerAddr' | 'name'> & { ownName?: string },
  ): Promise<ChatIdObj> {
    const res = await ensureAllAddressesExist({ [params.peerAddr]: { hasAccepted: false } });

    if (res.status === 'error') {
      throw {
        runtimeException: true,
        type: 'chat-creation',
        failedAddresses: res.errorData,
      };
    }

    let ownName = params.ownName;
    if (!ownName) {
      const user = await w3n.mail?.getUserId();
      ownName = user!.substring(0, user!.indexOf('@'));
    }

    return chatCreation.createOneToOneChat({
      ...params,
      ownName,
    });
  }

  async function acceptChatInvitation(chatId: ChatIdObj, chatMessageId: string, ownName: string): Promise<void> {
    const couldReceive = canReceiveInChat(chatId);
    await chatCreation.acceptChatInvitation(chatId, chatMessageId, ownName);
    if (!couldReceive && canReceiveInChat(chatId)) {
      catchUpChatOpenedForReceiving(chatId, 'local acceptance');
    }
  }

  async function createGroupChat(params: Pick<GroupChatView, 'chatId' | 'members' | 'name'>): Promise<ChatIdObj> {
    const res = await ensureAllAddressesExist(params.members);
    if (res.status === 'error') {
      throw {
        runtimeException: true,
        type: 'chat-creation',
        failedAddresses: res.errorData,
      };
    }

    const user = await w3n.mail?.getUserId();
    let groupMembers = { ...params.members };
    if (!includesAddress(Object.keys(groupMembers), user!)) {
      groupMembers = {
        ...groupMembers,
        [user!]: { hasAccepted: true },
      };
    }

    return chatCreation.createGroupChat({
      ...params,
      members: groupMembers,
      admins: [user!],
    });
  }

  return { createOneToOneChat, acceptChatInvitation, createGroupChat };
}
