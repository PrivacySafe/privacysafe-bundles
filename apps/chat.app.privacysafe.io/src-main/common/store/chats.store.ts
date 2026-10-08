/*
Copyright (C) 2024 - 2025 3NSoft Inc.

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
import { computed, inject, ref } from 'vue';
import { defineStore } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import cloneDeep from 'lodash/cloneDeep';
import { NOTIFICATIONS_KEY, NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import { getRandomId } from '@v1nt1248/3nclient-lib/utils';
import { useAppStore } from '@main/common/store/app.store';
import { useMessagesStore } from '@main/common/store/messages.store';
import { useUiIncomingStore } from '@main/common/store/ui.incoming.store';
import type {
  ChatIdObj,
  ChatMessageId,
  ChatListItemView,
  ChatListItemUiView,
  ChatViewBase,
  IncomingCallCmdArg,
  AddressCheckResult,
  ChatEvent,
  ChatSummary,
  ChatSystemMessageData,
  ChatWebRTCCallEvent,
  CallStateForGui,
} from '~/index';
import { getChatName } from '@main/common/utils/chat-ui.helper';
import { chatService, videoOpenerSrv } from '@main/common/services/external-services';
import { callBackend, isBackendUnreachable } from '@main/common/services/backend-availability';
import { areChatIdsEqual, chatMessageIdForCallEvent, generateChatMessageId } from '@shared/chat-ids';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ChatsStore');

export type ChatsStore = ReturnType<typeof useChatsStore>;

export interface ChatCreationException extends web3n.RuntimeException {
  type: 'chat-creation';
  failedAddresses: {
    addr: string;
    check?: AddressCheckResult;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exc?: any;
  }[];
}

export const useChatsStore = defineStore('chats', () => {
  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const route = useRoute();
  const router = useRouter();

  const appStore = useAppStore();
  const messagesStore = useMessagesStore();
  const uiIncomingStore = useUiIncomingStore();

  const chatList = ref<ChatListItemView[]>([]);
  // Distinguishes "still loading" from "no chats": the first getChatList()
  // answers only after the deno component has opened its databases, which on a
  // cold start takes seconds - an empty sidebar for that whole time reads as a
  // hang (or as an account with no chats).
  const chatListLoaded = ref(false);
  // Set when the list could not be fetched at all. Without it the sidebar had
  // only "loading" and "empty", so a background component that never answers
  // showed a spinner with no end and no explanation (2026-09-10).
  const chatListError = ref<unknown>(undefined);
  const incomingCalls = ref<IncomingCallCmdArg[]>([]);

  const chatListSortedByTime = computed<ChatListItemUiView[]>(() => {
    const named = chatList.value.map(c => ({
      ...c,
      displayName: getChatName(c),
    }));

    // Whether a name is shared with another chat is a property of the whole
    // list, so it is established here, once, and not by every list item.
    const countsByName = named.reduce((counts, { displayName }) => {
      counts[displayName] = (counts[displayName] ?? 0) + 1;
      return counts;
    }, {} as Record<string, number>);

    return named
      .map(c => ({
        ...c,
        isNameDuplicated: countsByName[c.displayName] > 1,
      }))
      .sort((a, b) => {
        const tA = a.lastMsg?.timestamp || a.createdAt;
        const tB = b.lastMsg?.timestamp || b.createdAt;
        return tB - tA;
      });
  });

  function getChatView(chatId: ChatIdObj): ChatListItemView | undefined {
    return chatList.value.find(cv => areChatIdsEqual(cv, chatId));
  }

  /**
   * Call-related fields of a chat list item that live only in memory: they are
   * never persisted, so they must be carried over whenever an item is rebuilt
   * from DB data — otherwise an unrelated chat update (a new message, a rename)
   * silently drops the ongoing-call state and, with it, the "Join Call" button.
   */
  function ephemeralCallFields(
    item: ChatListItemView | undefined,
  ): Pick<ChatViewBase, 'callStart' | 'incomingCall' | 'isCallActive'> {
    return item
      ? {
        callStart: item.callStart,
        incomingCall: item.incomingCall,
        isCallActive: item.isCallActive,
      }
      : {};
  }

  /**
   * Applies the aggregates that came along with a message event, sparing us the
   * getChat() request that refreshChatViewData() makes.
   * The fields are merged into the item in place rather than replacing it, so
   * ephemeralCallFields() is not needed here: the in-memory call state stays
   * where it is by construction.
   */
  function applyChatSummary({ chatId, unread, lastMsg }: ChatSummary): void {
    const ind = findIndexOfChatInCurrentList(chatId);
    if (ind >= 0) {
      chatList.value[ind] = {
        ...chatList.value[ind],
        unread,
        lastMsg,
      };
    }
  }

  async function refreshChatViewData(chatId: ChatIdObj) {
    const chatViewData = await chatService.getChat(chatId);

    if (chatViewData) {
      const ind = findIndexOfChatInCurrentList(chatViewData);
      if (ind >= 0) {
        chatList.value[ind] = {
          ...chatViewData,
          ...ephemeralCallFields(chatList.value[ind]),
        };
      }
    }
  }

  function clearIncomingCallsData() {
    incomingCalls.value = [];
  }

  /**
   * Puts "the caller cancelled this call" into the chat history.
   *
   * Two things report the same fact, and whichever comes first records it: the
   * caller's 'outgoing-call-cancelled' system message, and — since a
   * 'disconnect' of a call that is still ringing is now acted upon — the
   * 'call-ended' event carrying `reason: 'unanswered-here'`. Signalling is sent
   * out-of-queue, so the event usually wins; the system message travels an
   * ordinary delivery and remains the fallback for a lost 'disconnect'.
   *
   * Both callers guard on `incomingCall` still being set, which is what keeps
   * the second one from recording the call twice: the first clears it. That
   * guard is per window, though, and this record is written by a window — so
   * the guard says nothing about the user's other devices, and the record is
   * synchronized (see recordCallEvent).
   */
  async function recordCallCancelledByCaller(
    chatId: ChatIdObj, sender: string | undefined, callSessionId?: string,
  ): Promise<void> {
    const chat = getChatView(chatId);
    if (!chat) {
      return;
    }
    await recordCallEvent({
      chat,
      chatId,
      sender,
      subType: 'outgoing-call-cancelled',
      // The event path (reason 'unanswered-here') carries no session of its own,
      // and does not need to: it is guarded on the ringing call that this window
      // was told about, and that is where the session id came in.
      callSessionId: callSessionId ?? chat.incomingCall?.callSessionId,
    });
  }

  /**
   * Writes - and synchronizes - this window's record of a call event that
   * somebody else brought about: the caller withdrawing a call, or a peer
   * declining one.
   *
   * Both used to be saved locally with a generated id and nothing else. Every
   * device of ours does hear the peer's system message, so the record was
   * usually everywhere - but only on devices with a window open, and with a
   * different id in each of them. Deriving the id from the event and queueing a
   * phantom fixes both: the devices agree on the record, and a device whose
   * window is closed gets it from one whose window is not.
   *
   * A session id is needed for a derived id, and a peer on a build that predates
   * the field sends none. Then the record stays local, exactly as before: a
   * generated id cannot be agreed upon, and synchronizing it would put a second
   * line about one cancellation on every other device.
   */
  async function recordCallEvent(
    { chat, chatId, sender, subType, callSessionId }: {
      chat: ChatListItemView;
      chatId: ChatIdObj;
      sender: string | undefined;
      subType: 'outgoing-call-cancelled' | 'incoming-call-cancelled';
      callSessionId: string | undefined;
    },
  ): Promise<void> {
    const chatSystemData: ChatSystemMessageData = {
      event: 'webrtc-call',
      value: {
        sender: sender!,
        subType,
        chatId,
        callSessionId,
      },
    };
    // `sender` is in the id because one call session yields one such record per
    // person: in a group call two members declining are two lines, and an id
    // that named only the session would drop the second of them as a record
    // already there. The kinds are apart for the same reason - the host
    // withdrawing a call and the user declining it name the same `sender` in a
    // one-to-one chat.
    const derivedId = (callSessionId && sender)
      ? chatMessageIdForCallEvent(
        (subType === 'outgoing-call-cancelled') ? 'call-withdrawn' : 'call-cancelled',
        callSessionId,
        sender,
      )
      : undefined;
    const msgData = {
      // Not an incoming message, for all that it reports someone else's doing:
      // it is a record this device writes, and the copy that reaches the user's
      // other devices is written as a local one there too (see the
      // 'call'/'webrtc-call' branch of handleSystemSync). The two must not
      // differ. Nothing is lost - a system record never counts as unread, and
      // who did what is inside the body.
      isIncomingMsg: false,
      groupChatId: chat.isGroupChat ? chat.chatId : null,
      otoPeerCAddr: chat.isGroupChat ? null : chat.chatId,
      groupSender: chat.isGroupChat ? (sender ?? null) : null,
      timestamp: Date.now(),
    };

    const systemMsg = derivedId
      ? await chatService.saveAndSyncLocalSystemMsg(
        appStore.user, chatId, chatSystemData, { ...msgData, chatMessageId: derivedId },
      )
      : await chatService.makeAndSaveMsgToDb(appStore.user, {
        ...msgData,
        ...generateChatMessageId(),
        chatMessageType: 'system',
        body: JSON.stringify(chatSystemData),
      });
    await messagesStore.handleAddedMsg(systemMsg);
  }

  async function createNewOneToOneChat(
    name: string,
    peerAddr: string,
    ownName?: string,
  ): Promise<ChatIdObj | undefined> {
    try {
      return await chatService.createOneToOneChat({ name, peerAddr, ownName });
    } catch (error: unknown) {
      $createNotice({
        type: 'error',
        content: t('chat.app_message.error.create_oto_chat'),
      });
      log.error('Error creating a one to one chat. ', error);
    }
  }

  async function createNewGroupChat(
    name: string,
    groupMembers: Record<string, { hasAccepted: boolean }>,
  ): Promise<ChatIdObj | undefined> {
    try {
      return await chatService.createGroupChat({
        name,
        chatId: getRandomId(20),
        members: groupMembers,
      });
    } catch (error: unknown) {
      $createNotice({
        type: 'error',
        content: t('chat.app_message.error.create_group_chat'),
      });
      log.error('Error creating a group chat. ', error);
    }
  }

  async function acceptChatInvitation({ chatId, chatMessageId }: ChatMessageId, ownName?: string): Promise<void> {
    try {
      if (!ownName) {
        ownName = appStore.user.substring(0, appStore.user.indexOf('@'));
      }

      return await chatService.acceptChatInvitation(chatId, chatMessageId, ownName);
    } catch (err) {
      log.error(`Accepting chat invite failed with `, err);
      throw err;
    }
  }

  /**
   * Marks the background component unreachable when a call says so.
   *
   * Otherwise the "service is not responding" overlay could only ever appear
   * at start-up: a window that was working when the component froze had no
   * path to that state at all, and simply went quiet - which is how the
   * incident looked from the user's side.
   */
  function noteBackendVerdict(err: unknown): void {
    if (isBackendUnreachable(err)) {
      appStore.backendState = 'unreachable';
    }
  }

  async function refreshChatList() {
    const previousList = chatList.value;
    let freshList: ChatListItemView[];
    try {
      freshList = await callBackend('getChatList', () => chatService.getChatList());
    } catch (err) {
      // Kept, rather than thrown on: this used to reach onBeforeMount, get
      // re-thrown and end as an unhandled rejection, with the spinner still
      // turning. The list is now allowed to say it failed.
      chatListError.value = err;
      noteBackendVerdict(err);
      log.error(`Failed to load the chat list`, err);
      return;
    }
    chatListError.value = undefined;
    // Re-apply in-memory call state: getChatList() returns DB data only, so an
    // unrelated refresh (chat added/removed) would otherwise wipe the ongoing
    // call state of every chat in the list.
    chatList.value = freshList.map(chat => ({
      ...chat,
      ...ephemeralCallFields(previousList.find(item => areChatIdsEqual(item, chat))),
    }));
    chatListLoaded.value = true;
    resetRouteIfItPointsToRemovedChat();
  }

  function resetRouteIfItPointsToRemovedChat(): void {
    const { chatId } = route.params as { chatId: string };
    if (chatId) {
      const foundChat = chatList.value.find(c => (c.chatId === chatId));
      if (!foundChat) {
        router.push({ name: 'chats' });
      }
    }
  }

  function findIndexOfChatInCurrentList(chatId: ChatIdObj): number {
    return chatList.value.findIndex(
      c => areChatIdsEqual(c, chatId),
    );
  }

  /**
   * Returns whether the item was found and updated. Callers that report the
   * update to the log need that: an incoming call whose chat is not in this
   * window's list is armed nowhere, and a success line written regardless turns
   * the log into a false witness.
   */
  async function updateChatItemInList(
    chatId: ChatIdObj, value: Partial<ChatListItemView>,
  ): Promise<boolean> {
    let chatInd = findIndexOfChatInCurrentList(chatId);
    if (chatInd < 0) {
      await refreshChatList();
      chatInd = findIndexOfChatInCurrentList(chatId);
      if (chatInd < 0) {
        log.error(`The chat with chatId ${chatId.chatId} does not exist.`);
        return false;
      }
    }

    const currentValue: ChatListItemView = cloneDeep(chatList.value[chatInd]);
    // @ts-expect-error
    chatList.value[chatInd] = {
      ...currentValue,
      ...value,
    };
    return true;
  }

  /**
   * Turns a snapshot from the background component into the three in-memory
   * call fields of the chat list.
   *
   * The mapping is the same one the push events make (see useInitialize):
   *   in a call here, and it is running   -> callStart, i.e. an End Call button
   *   rejoinable                          -> isCallActive, i.e. "Join call"
   *   ringing and not ours                -> incomingCall
   * A chat absent from the snapshot loses all three: the snapshot is the
   * authority, and clearing state nobody will ever clear otherwise is the
   * reason this exists.
   */
  function applyCallsState(snapshot: CallStateForGui[]): void {
    const byChat = new Map(snapshot.map(s => [chatIdAsKey(s.chatId), s]));
    chatList.value = chatList.value.map(item => {
      const state = byChat.get(chatIdAsKey(item));
      if (!state) {
        return { ...item, callStart: undefined, isCallActive: false, incomingCall: undefined };
      }
      const runningHere = state.inCallHere
        && ['dialing', 'connecting', 'active', 'winding-down'].includes(state.state);
      return {
        ...item,
        callStart: runningHere ? (item.callStart ?? state.since) : undefined,
        isCallActive: (state.state === 'rejoinable'),
        incomingCall: ((state.state === 'ringing') && !state.inCallHere)
          ? item.incomingCall
          : undefined,
      };
    });
  }

  function chatIdAsKey({ isGroupChat, chatId }: ChatIdObj): string {
    return `${isGroupChat ? 'g' : 's'}/${chatId}`;
  }

  /**
   * Asks the background component what it thinks is going on, and makes the
   * list agree with it.
   *
   * When the component cannot be reached, the call fields are cleared anyway:
   * an End Call button armed by a service that no longer answers does nothing
   * when pressed, and a button that does nothing is worse than none.
   */
  async function reconcileCallsState(): Promise<void> {
    try {
      const snapshot = await callBackend(
        'getCallsState', () => videoOpenerSrv.getCallsState(), { windowMillis: 5000 },
      );
      applyCallsState(snapshot);
      if (appStore.backendState === 'unreachable') {
        // It answers again. The minute-by-minute reconcile is the only thing
        // that runs on its own, so it is also the only thing that can notice.
        appStore.backendState = 'ready';
      }
    } catch (err) {
      noteBackendVerdict(err);
      log.error(`Failed to get the state of calls; clearing call state of the chat list`, err);
      applyCallsState([]);
    }
  }

  async function handleBackgroundChatEvents(event: ChatEvent): Promise<void> {
    switch (event.event) {
      case 'updated': {
        const { chat } = event;
        const chatInd = findIndexOfChatInCurrentList(chat);
        if (chatInd < 0) {
          await refreshChatList();
        } else {
          chatList.value[chatInd] = {
            ...chat,
            ...ephemeralCallFields(chatList.value[chatInd]),
          };
        }
        break;
      }

      case 'added': {
        const { chat } = event;
        const chatInd = findIndexOfChatInCurrentList(chat);
        if (chatInd < 0) {
          chatList.value.unshift(chat);
        } else {
          await refreshChatList();
        }
        break;
      }

      case 'removed': {
        const { chatId } = event;
        const chatInd = findIndexOfChatInCurrentList(chatId);
        if (chatInd >= 0) {
          chatList.value.splice(chatInd, 1);
        }
        resetRouteIfItPointsToRemovedChat();
        break;
      }

      case 'messages-removed': {
        const { chatId, chatSummary } = event;
        if (chatSummary) {
          applyChatSummary(chatSummary);
        }
        messagesStore.handleAllMsgsRemoved(chatId);
        break;
      }

      case 'webRTCCall': {
        const { value } = event as ChatWebRTCCallEvent;
        const { data } = value || {};
        const { chatId, sender, subType, callSessionId } = data || {};
        if (!chatId) {
          return;
        }

        const chatInd = findIndexOfChatInCurrentList(chatId);
        if (chatInd === -1) {
          log.warn(
            `Ignoring '${subType}' call system message: chat ${chatId.chatId} is not in the list`,
          );
          return;
        }

        const chat = chatList.value[chatInd];
        const { callStart, incomingCall } = chat;

        if (subType === 'outgoing-call-cancelled') {
          // Only meaningful while a call is ringing here: it is the ringing UI
          // that this withdraws, and recordCallCancelledByCaller() guards on the
          // same field to keep the call out of the history twice.
          if (!incomingCall) {
            return;
          }
          // The host's own session id is preferred over the one this window was
          // told when the call started ringing: they are the same call, but only
          // the message is authoritative about which session it withdraws.
          await recordCallCancelledByCaller(chatId, sender, callSessionId);
          await uiIncomingStore.dismissIncomingCall(chatId, true);
          return;
        }

        if (subType === 'incoming-call-cancelled') {
          // Only the chat history is this window's business; ending the call is
          // the background service's (see onIncomingCallSysMsg). It is the side
          // that knows which call session this message names and can refuse a
          // cancellation of an earlier call - the inbox keeps these for days and
          // replays them at start-up, and one such replay used to close a call
          // that had only just started. This window has no session id to check
          // against, so it must not be a second decider.
          //
          // Deliberately not guarded on `callStart`/`incomingCall` either: those
          // are ephemeral fields of this window's chat list, set from a
          // 'call-started' event (see useInitialize.ts), so a window opened after
          // the call began - or reloaded during it - has neither and used to drop
          // the message on the floor, leaving the cancelled call out of the
          // history.
          log.info(
            `Call in chat ${chatId.chatId} was declined by ${sender ?? 'unknown'} `
              + `(call known to this window: ${!!callStart || !!incomingCall})`,
          );

          await recordCallEvent({ chat, chatId, sender, subType, callSessionId });
        }

        break;
      }

      default: {
        // Every ChatEvent variant is handled above, so getting here means the
        // backend sends something this build doesn't know about. Typing the
        // value as never also makes the compiler flag a forgotten branch when a
        // new event is added - which is how 'messages-removed' went unhandled.
        const unhandledEvent: never = event;
        throw Error(`Unknown chat event: ${JSON.stringify(unhandledEvent)}`);
      }
    }
  }

  function setIncomingCallsData(cmd: IncomingCallCmdArg) {
    incomingCalls.value.push(cmd);
  }

  return {
    chatList,
    chatListLoaded,
    chatListError,
    chatListSortedByTime,
    refreshChatList,
    reconcileCallsState,
    findIndexOfChatInCurrentList,
    getChatView,
    refreshChatViewData,
    applyChatSummary,
    handleBackgroundChatEvents,
    createNewOneToOneChat,
    createNewGroupChat,
    acceptChatInvitation,
    updateChatItemInList,
    recordCallCancelledByCaller,
    clearIncomingCallsData,
    setIncomingCallsData,
  };
});
