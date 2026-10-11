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
import { useRoute, useRouter } from 'vue-router';
import type { ChatWithIncomingCall, ChatRoute, ChatsRoute, ChatWithFwdMsgRef } from '@main/desktop/router.ts';
import { ChatIdObj, ChatMessageId } from '~/asmail-msgs.types.ts';

export function useRouting() {
  const route = useRoute();
  const router = useRouter();

  function goToChatRoute(
    chatIdObj: ChatIdObj,
    opts?: { callingPeer?: string; callSessionId?: string; callSentAt?: number },
  ) {
    const r: ChatRoute = {
      name: 'chat',
      params: {
        chatType: chatIdObj.isGroupChat ? 'g' : 's',
        chatId: chatIdObj.chatId,
      },
    };

    if (opts?.callingPeer) {
      (r as ChatWithIncomingCall).query = {
        call: 'yes',
        peerAddress: opts.callingPeer,
        ...(opts.callSessionId && { callSessionId: opts.callSessionId }),
        ...(opts.callSentAt && { callSentAt: `${opts.callSentAt}` }),
      };
    }

    return router.push(r);
  }

  function goToChatsRoute(opts?: { createNew?: boolean; }) {
    const r: ChatsRoute = {
      name: 'chats',
      ...(opts?.createNew && {
        query: { createNewChat: 'yes' },
      }),
    };

    return router.push(r);
  }

  function getChatIdFromRoute(params?: ChatRoute['params']): ChatIdObj | undefined {
    const { chatType, chatId } = params ?? route.params as ChatRoute['params'];
    if (!chatType || !chatId) {
      return;
    }

    return {
      isGroupChat: chatType === 'g',
      chatId,
    };
  }

  function getIncomingCallParamsFromRoute(route: ChatWithIncomingCall): {
    chatId: ChatIdObj,
    peerAddress: string,
    callSessionId?: string,
    callSentAt?: number,
  } | undefined {
    if (route.query.call !== 'yes') {
      return;
    }

    const sentAtNum = route.query.callSentAt ? parseInt(route.query.callSentAt, 10) : undefined;
    return {
      chatId: getChatIdFromRoute(route.params)!,
      peerAddress: route.query.peerAddress,
      callSessionId: route.query.callSessionId,
      callSentAt: Number.isFinite(sentAtNum) ? sentAtNum : undefined,
    };
  }

  function getForwardedMsgIdFromRoute(query?: ChatWithFwdMsgRef['query']): ChatMessageId | undefined {
    const {
      fwdMsg,
      fwdMsgChatId: chatId,
      fwdMsgChatType,
      fwdMsgId: chatMessageId,
    } = query ?? route.query as ChatWithFwdMsgRef['query'];

    if (!fwdMsg) {
      return;
    }

    return {
      chatId: {
        isGroupChat: fwdMsgChatType === 'g',
        chatId,
      },
      chatMessageId,
    };
  }

  function hasCreateNewChatFlagInRoute(query?: ChatsRoute['query']): boolean {
    const { createNewChat } = query ?? route.query as NonNullable<ChatsRoute['query']>;
    return createNewChat === 'yes';
  }

  return {
    route,
    router,
    getChatIdFromRoute,
    getForwardedMsgIdFromRoute,
    hasCreateNewChatFlagInRoute,
    getIncomingCallParamsFromRoute,
    goToChatsRoute,
    goToChatRoute,
  };
}
