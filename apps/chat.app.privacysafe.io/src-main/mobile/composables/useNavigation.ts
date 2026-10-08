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
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { APP_ROUTES } from '@main/mobile/constants';
import type { RouteChat } from '@main/mobile/types';
import { ChatIdObj, ChatMessageId } from '~/asmail-msgs.types.ts';

export function useNavigation() {
  const route = useRoute();
  const router = useRouter();

  const currentChatId = computed(() => {
    if (route.name !== 'chat') {
      return null;
    }

    return (route as unknown as RouteChat).params?.chatId;
  });
  const isCurrentChatGroup = computed(() => {
    if (!currentChatId.value) {
      return null;
    }

    return (route as unknown as RouteChat).params?.chatType === 'g';
  });

  async function navigateToChats() {
    return router.push({ name: APP_ROUTES.CHATS });
  }

  async function navigateToChat(
    { params, query }:
    { params: Partial<RouteChat['params']>, query?: Partial<RouteChat['query']> },
  ) {
    const { chatId, chatType = 's' } = route.params as RouteChat['params'];
    const { call, peerAddress, callSessionId, callSentAt } = route.query as RouteChat['query'];

    const newRouteData: RouteChat = {
      name: APP_ROUTES.CHAT,
      params: {
        chatType: params.chatType || chatType,
        chatId: params.chatId || chatId,
      },
      query: {
        ...((query?.call || call) && { call: query?.call || call }),
        ...((query?.peerAddress || peerAddress) && { peerAddress: query?.peerAddress || peerAddress }),
        ...((query?.callSessionId || callSessionId) && { callSessionId: query?.callSessionId || callSessionId }),
        ...((query?.callSentAt || callSentAt) && { callSentAt: query?.callSentAt || callSentAt }),
      },
    };

    return router.push(newRouteData);
  }

  function getChatIdFromRoute(params?: RouteChat['params']): ChatIdObj | undefined {
    const { chatType, chatId } = params ?? route.params as RouteChat['params'];
    if (!chatType || !chatId) {
      return;
    }

    return {
      isGroupChat: chatType === 'g',
      chatId,
    };
  }

  function getForwardedMsgIdFromRoute(query?: RouteChat['query']): ChatMessageId | undefined {
    const {
      fwMsg,
      fwdMsgChatId: chatId,
      fwdMsgChatType,
      fwdMsgId: chatMessageId,
    } = query ?? route.query as RouteChat['query'];

    if (!fwMsg) {
      return;
    }

    return {
      chatId: {
        isGroupChat: fwdMsgChatType === 'g',
        chatId: chatId!,
      },
      chatMessageId: chatMessageId!,
    };
  }

  function getIncomingCallParamsFromRoute(route: RouteChat): {
    chatId: ChatIdObj;
    peerAddress: string;
    callSessionId?: string;
    callSentAt?: number;
  } | undefined {
    if (route.query.call !== 'yes') {
      return;
    }

    const sentAtNum = route.query.callSentAt ? parseInt(route.query.callSentAt, 10) : undefined;
    return {
      chatId: getChatIdFromRoute(route.params)!,
      peerAddress: route.query.peerAddress as string,
      callSessionId: route.query.callSessionId,
      callSentAt: Number.isFinite(sentAtNum) ? sentAtNum : undefined,
    };
  }

  return {
    route,
    router,
    currentChatId,
    isCurrentChatGroup,
    navigateToChats,
    navigateToChat,
    getChatIdFromRoute,
    getForwardedMsgIdFromRoute,
    getIncomingCallParamsFromRoute,
  };
}
