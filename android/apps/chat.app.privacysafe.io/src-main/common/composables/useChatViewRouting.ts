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
import { inject, nextTick, watch, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import {
  RouteLocationNormalized,
  RouteLocationNormalizedLoaded,
  RouteLocationNormalizedLoadedGeneric,
  Router,
} from 'vue-router';
import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import type { ChatIdObj, ChatMessageId, RegularMsgView } from '~/index';
import type { ChatRoute, ChatRouteType, ChatWithFwdMsgRef, ChatWithIncomingCall } from '@main/desktop/router';
import type { RouteChat } from '@main/mobile/types';
import { areChatIdsEqual } from '@shared/chat-ids';
import { useChatsStore } from '@main/common/store/chats.store';
import { useChatStore } from '@main/common/store/chat.store';
import { useMessagesStore } from '@main/common/store/messages.store';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ChatViewRouting');

/**
 * How old an incoming-call command may be and still arm the incoming-call UI.
 * Well under the background service's RINGING_NO_ANSWER_TIMEOUT_MILLIS: a
 * command older than this is a re-delivery (window re-creation), not a call
 * that is still ringing.
 */
const INCOMING_CALL_CMD_MAX_AGE_MILLIS = 60_000;

export interface NavigationUtils {
  route: RouteLocationNormalizedLoadedGeneric;
  router: Router;
  getChatIdFromRoute: (params?: ChatRoute['params'] | RouteChat['params']) => ChatIdObj | undefined;
  getForwardedMsgIdFromRoute: (
    query?: ChatWithFwdMsgRef['query'] | RouteChat['query'],
  ) => ChatMessageId | undefined;
  getIncomingCallParamsFromRoute: (route: ChatWithIncomingCall | RouteChat) =>
    | {
        chatId: ChatIdObj;
        peerAddress: string;
        callSessionId?: string;
        callSentAt?: number;
      }
    | undefined;
}

/**
 * What the lifecycle zone is handed by the view around it: the navigation
 * utilities of the shell it runs in, the one shared task runner and recording
 * registry, and the zone APIs it drives on mount, unmount and chat change.
 */
export interface ChatViewRoutingDeps {
  navigationUtils: NavigationUtils;
  cancelTasks: () => void;
  recordingPlayback: { stopCurrent: () => void };
  setMsgForWhichInfoIsDisplayed: (value: Nullable<RegularMsgView>) => void;
  inputEl: Ref<Nullable<HTMLTextAreaElement>>;
  msgText: Ref<string>;
  prepareInfoFromForwardedMessage: (fwdMsgId: ChatMessageId) => Promise<void>;
  onKeydown: (event: KeyboardEvent) => void;
  ownedStoredIds: Set<string>;
  discardOwnedStoredItems: (ids: string[]) => Promise<void>;
  takeExternalDraft: (draftId: string) => Promise<void>;
  messageListElement: Ref<Nullable<HTMLDivElement>>;
  onMessageListScroll: () => void;
  scrollToFirstUnreadMessage: () => void;
  resetSearch: () => void;
}

/**
 * The lifecycle of the chat screen: the route query the shell uses to hand it
 * an incoming call or a draft made by another app, the initial load, and what
 * a change of chat and an unmount have to tear down.
 */
export function useChatViewRouting({
  navigationUtils,
  cancelTasks,
  recordingPlayback,
  setMsgForWhichInfoIsDisplayed,
  inputEl,
  msgText,
  prepareInfoFromForwardedMessage,
  onKeydown,
  ownedStoredIds,
  discardOwnedStoredItems,
  takeExternalDraft,
  messageListElement,
  onMessageListScroll,
  scrollToFirstUnreadMessage,
  resetSearch,
}: ChatViewRoutingDeps) {
  const { t } = useI18n();
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY);

  const { route, router, getChatIdFromRoute, getForwardedMsgIdFromRoute, getIncomingCallParamsFromRoute } =
    navigationUtils;

  const { updateChatItemInList } = useChatsStore();
  const { currentChatId } = storeToRefs(useChatStore());
  const { setChatAndFetchMessages } = useChatStore();
  const { clearSelectedMessages } = useMessagesStore();

  async function setStateFollowingRouteQuery(query?: ChatWithFwdMsgRef['query']) {
    const fwdMsgId = getForwardedMsgIdFromRoute(query);
    if (fwdMsgId) {
      await prepareInfoFromForwardedMessage(fwdMsgId);
    }
  }

  const routeQueryWatching = watch(
    () => route.query.call,
    async value => {
      if (value === 'yes') {
        const { chatId, peerAddress, callSessionId, callSentAt } = getIncomingCallParamsFromRoute(
          route as unknown as ChatWithIncomingCall,
        )!;
        // An incoming-call command can reach this window long after it was
        // issued: getStartedCmd() re-delivers the starting command when the
        // window is re-created. Arming the UI from a stale one puts up a Join
        // button for a call that is over, so age gates it here - the command
        // now says when it was sent.
        if (callSentAt && Date.now() - callSentAt > INCOMING_CALL_CMD_MAX_AGE_MILLIS) {
          log.info(
            `Ignoring stale incoming-call command for chat ${chatId.chatId} from ` +
              `${peerAddress} (age: ${Date.now() - callSentAt}ms)`,
          );
          nextTick(() => {
            router.replace({ query: {} });
          });
          return;
        }
        const armed = await updateChatItemInList(chatId, {
          incomingCall: { chatId, peerAddress, callSessionId },
        });
        // The last link of the incoming-call chain: the background service asked
        // the shell for the incoming-call UI, the command routed here, and
        // `incomingCall` is what drives both the Join/Decline buttons and the
        // ringtone. Logged at `info` (this window never turns diagnostics on), so
        // that "it only rang on one device" can be pinned on either the signal
        // or the UI, and not left between them. The outcome is reported, not
        // assumed: the chat may not be in this window's list at all, and a line
        // claiming success there would send the next diagnosis the wrong way.
        log.info(
          armed
            ? `Incoming-call UI armed for chat ${chatId.chatId} from ${peerAddress}`
            : `Incoming-call UI NOT armed for chat ${chatId.chatId} from ${peerAddress}: ` +
                `the chat is not in this window's list`,
        );
        nextTick(() => {
          router.replace({ query: {} });
        });
      }
    },
    { immediate: true },
  );

  const draftQueryWatching = watch(
    () => [route.query.draft, currentChatId.value?.chatId] as const,
    async ([draftId, chatId]) => {
      // Waits for the chat of the route to be set: the draft is checked
      // against it, and the composer of another chat must not get its files.
      if (
        !draftId ||
        typeof draftId !== 'string' ||
        !chatId ||
        !areChatIdsEqual(getChatIdFromRoute(), currentChatId.value!)
      ) {
        return;
      }

      nextTick(() => {
        router.replace({ query: {} });
      });
      await takeExternalDraft(draftId).catch(e => {
        log.error(`Error taking the external draft ${draftId}.`, e);
        notifications?.$createNotice({ type: 'error', content: t('chat.attachment.external_draft.error') });
      });
    },
    { immediate: true },
  );

  async function doAfterMount() {
    const chatId = getChatIdFromRoute();

    if (chatId) {
      await setChatAndFetchMessages(chatId);
      await setStateFollowingRouteQuery();
    }

    scrollToFirstUnreadMessage();

    if (currentChatId.value?.isGroupChat && inputEl.value) {
      inputEl.value.addEventListener('keydown', onKeydown);
    }
  }

  function doBeforeUnMount() {
    // Before anything else: an unmounted media element is not a stopped one.
    recordingPlayback.stopCurrent();
    routeQueryWatching.stop();
    draftQueryWatching.stop();
    // Optional: a chat left before its messages arrived never mounted the list,
    // and unmounting must not throw on the way out of a chat that showed none.
    messageListElement.value?.removeEventListener('scroll', onMessageListScroll);

    // Not awaited: unmounting cannot wait on storage, and there is nothing to
    // do with the outcome besides logging it, which the call itself does.
    discardOwnedStoredItems([...ownedStoredIds]);

    if (currentChatId.value?.isGroupChat && inputEl.value) {
      inputEl.value.removeEventListener('keydown', onKeydown);
    }
  }

  /**
   * Takes no `next`: the callback form is deprecated, and a guard that returns
   * nothing lets the navigation through - which is all this one ever did with
   * it.
   */
  async function doBeforeRouteUpdate(to: RouteLocationNormalized, from: RouteLocationNormalizedLoaded) {
    const chatIdFrom = getChatIdFromRoute(from.params as ChatRouteType['params']);
    const chatIdTo = getChatIdFromRoute(to.params as ChatRouteType['params']);

    if (chatIdTo && !areChatIdsEqual(chatIdFrom, chatIdTo)) {
      // The bubbles of this chat are about to be replaced, and taking a playing
      // element out of the DOM does not silence it.
      recordingPlayback.stopCurrent();
      cancelTasks();
      clearSelectedMessages();
      await setChatAndFetchMessages(chatIdTo);
      await setStateFollowingRouteQuery(to.query as ChatWithFwdMsgRef['query']);
      msgText.value = '';

      scrollToFirstUnreadMessage();
      onMessageListScroll();
      setMsgForWhichInfoIsDisplayed(null);
      // The previous chat's search results and their highlight go with it.
      resetSearch();
    }
  }

  return {
    doAfterMount,
    doBeforeRouteUpdate,
    doBeforeUnMount,
  };
}

export type ChatViewRouting = ReturnType<typeof useChatViewRouting>;
