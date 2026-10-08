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
import { inject, ref } from 'vue';
import { defineStore } from 'pinia';
import { useI18n } from 'vue-i18n';
import cloneDeep from 'lodash/cloneDeep';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { NOTIFICATIONS_KEY, NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import { Sound } from '@shared/sounds';
import { chatService, videoOpenerSrv } from '@main/common/services/external-services';
import { useAppStore } from '@main/common/store/app.store';
import { useChatsStore } from '@main/common/store/chats.store';
import { useMessagesStore } from '@main/common/store/messages.store';
import { chatIdToString, chatMessageIdForCallEvent, generateChatMessageId } from '@shared/chat-ids';
import { wrapWithTimeout } from '@shared/processes/timeouts';
import type { ChatIdObj } from '~/asmail-msgs.types';
import { makeLogger } from '@shared/logger';

const log = makeLogger('UiIncomingStore');

export const useUiIncomingStore = defineStore('ui-incoming', () => {
  const appStore = useAppStore();
  const chatsStore = useChatsStore();
  const messagesStore = useMessagesStore();
  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  let ring: Nullable<Sound> = null;

  function noticeCallAlreadyOver(): void {
    $createNotice({
      type: 'info',
      content: t('va.presettings.call_already_over'),
    });
  }

  async function startRinging() {
    const ringFileUrl = new URL('@main/common/assets/sounds/ring_tone.mp3', import.meta.url).href;
    ring = await Sound.from(ringFileUrl);
    ring.playInLoop();
  }

  function stopRinging() {
    if (ring) {
      ring.stop();
      ring = null;
    }
  }

  async function toggleRinging(flag: boolean) {
    if (flag) {
      await startRinging();
    } else {
      stopRinging();
    }
  }

  /**
   * Returns 'joined' when the call was actually answered, and 'no-call' when
   * the background service had no live call to join - the button was armed for
   * a call that has since ended. In that case every ephemeral call field is
   * cleared, so the dead button does not linger; the caller shows the user a
   * notice.
   */
  async function joinIncomingCall(chatObjId: ChatIdObj, sender: string): Promise<'joined' | 'no-call'> {
    // At `info`, here and in dismissIncomingCall: which device the user actually
    // answered on, from the side that saw the button. The background service logs
    // the same event from its own side (joinOrDismissCallInRoom); having both is
    // what tells "the button was never pressed here" from "it was pressed and the
    // request did not get through".
    log.info(`Joining incoming call in chat ${chatObjId.chatId} from ${sender}`);
    const callSessionId = chatsStore.getChatView(chatObjId)?.incomingCall?.callSessionId;
    await chatsStore.updateChatItemInList(chatObjId, { incomingCall: undefined });
    stopRinging();
    const { handled } = await videoOpenerSrv.joinOrDismissCallInRoom(
      chatObjId, true, sender, callSessionId,
    );
    if (!handled) {
      await chatsStore.updateChatItemInList(chatObjId, {
        isCallActive: false,
        callStart: undefined,
      });
      noticeCallAlreadyOver();
      return 'no-call';
    }
    return 'joined';
  }

  async function dismissIncomingCall(chatObjId: ChatIdObj, withoutMakeSystemMsg: boolean) {
    const chat = chatsStore.getChatView(chatObjId);
    if (!chat) {
      return;
    }

    const currentIncomingCall = cloneDeep(chat.incomingCall);
    if (!currentIncomingCall?.peerAddress) {
      return;
    }

    log.info(
      `Declining incoming call in chat ${chatObjId.chatId} from `
        + `${currentIncomingCall.peerAddress} (system message: ${!withoutMakeSystemMsg})`,
    );

    await chatsStore.updateChatItemInList(chatObjId, { incomingCall: undefined });
    stopRinging();
    // Pass the host's address so the host can be told this was an explicit
    // decline (as opposed to being unreachable) — see joinOrDismissCallInRoom.
    // It answers with the id of the call session, which the system message below
    // names: that is how the host tells this cancellation from one of an earlier
    // call still sitting in its inbox.
    const { handled, callSessionId } = await videoOpenerSrv.joinOrDismissCallInRoom(
      chatObjId, false, currentIncomingCall.peerAddress, currentIncomingCall.callSessionId,
    );
    if (!handled) {
      // Nothing was declined: the call this button was armed for is already
      // over. A system message about a cancellation would name no session (or
      // the wrong one) and only litter peers' inboxes.
      noticeCallAlreadyOver();
      return;
    }

    const recipients: string[] = [];
    if (chat.isGroupChat) {
      for (const member of Object.keys(chat.members)) {
        if (member !== appStore.user) {
          recipients.push(member);
        }
      }
    } else {
      recipients.push(currentIncomingCall.peerAddress);
    }

    if (withoutMakeSystemMsg) {
      return;
    }

    // Derived from the session id when the backend named one: declining on two
    // devices at once would otherwise leave two lines about one cancellation on
    // every device of ours (see chatMessageIdForCallEvent). The peer gets the
    // same id in the system message below, and benefits from it too - two
    // identical declines collapse into one there as a redelivery.
    //
    // The address the id names is the caller's, because that is the one this
    // record puts in `sender` - the same rule the records of somebody else's
    // decline follow (see recordCallEvent), so declines by different people in
    // one group call stay different records.
    const { chatMessageId, timestamp } = callSessionId
      ? {
        chatMessageId: chatMessageIdForCallEvent(
          'call-cancelled', callSessionId, currentIncomingCall.peerAddress,
        ),
        timestamp: Date.now(),
      }
      : generateChatMessageId();

    // Synchronized, not merely saved: declining is a decision of this device
    // alone, and the user's other devices - the ones that yielded when this one
    // took the call, or never rang at all - have nothing else to learn it from.
    // `sender` is the peer here, not us: that is what makes the line read as
    // "the incoming call from X was cancelled" (see getTextForChatSystemMessage).
    const systemMsg = await chatService.saveAndSyncLocalSystemMsg(
      appStore.user,
      chatObjId,
      {
        event: 'webrtc-call',
        value: {
          subType: 'incoming-call-cancelled',
          sender: currentIncomingCall.peerAddress,
          chatId: chatObjId,
          callSessionId,
        },
      },
      {
        isIncomingMsg: false,
        groupChatId: chat.isGroupChat ? chat.chatId : null,
        otoPeerCAddr: chat.isGroupChat ? null : chat.chatId,
        groupSender: chat.isGroupChat ? appStore.user : null,
        chatMessageId,
        timestamp,
      },
    );
    await messagesStore.handleAddedMsg(systemMsg);

    // Peers are told last, and their failure is not this function's failure.
    // The host already learned of the decline from the 'call-declined' signal
    // that the backend sent before any of this; the system message is the chat
    // history for the peers and a fallback teardown path. When it used to go
    // first, one rejected delivery took the local record with it and the
    // cancellation existed nowhere at all (live run of 2026-08-15).
    chatService.sendSystemDeletableMessage({
      chatId: chatObjId,
      recipients,
      chatMessageId,
      chatSystemData: {
        event: 'webrtc-call',
        value: {
          subType: 'incoming-call-cancelled',
          sender: appStore.user,
          chatId: chatObjId,
          callSessionId,
        },
      },
    }).catch(err => {
      log.error(
        `Failed to tell peers that the call in chat ${chatObjId.chatId} was declined here`,
        err,
      );
    });
  }

  /**
   * Chats whose call window has been asked for and has not appeared yet.
   *
   * Opening that window takes seconds, and until it does the chat header
   * looks exactly as it did before the click - so the user presses again.
   * The background component now ignores the repeat (see guiOpening in
   * call.ts), but the button has to say so too, which is what this drives.
   */
  const callsBeingStarted = ref<string[]>([]);

  function isStartingCall(chatObjId: ChatIdObj): boolean {
    return callsBeingStarted.value.includes(chatIdToString(chatObjId));
  }

  async function startCall(chatObjId: ChatIdObj): Promise<void> {
    const key = chatIdToString(chatObjId);
    if (callsBeingStarted.value.includes(key)) {
      return;
    }
    callsBeingStarted.value = [...callsBeingStarted.value, key];
    try {
      await videoOpenerSrv.startVideoCallForChatRoom(chatObjId);
    } catch (err) {
      log.error(`Failed to start a call in chat ${chatObjId.chatId}`, err);
      $createNotice({
        type: 'error',
        content: t('chat.call.startFailed'),
      });
    } finally {
      callsBeingStarted.value = callsBeingStarted.value.filter(k => (k !== key));
    }
  }

  /**
   * How long the End Call button waits on the background component.
   *
   * The work behind the call is local - close the window, send a 'disconnect'
   * out of queue - so anything past this is not slowness but a component that
   * is not answering.
   */
  const END_CALL_TIMEOUT_MILLIS = 15_000;

  /**
   * Ends the call, and makes sure the button goes away either way.
   *
   * It used to be one unawaited line whose failure was swallowed. That is how
   * a button that did nothing at all survived a whole incident: the component
   * had stopped answering, the click went nowhere, and nothing was ever going
   * to arrive that would clear the button (2026-09-10). Now the outcome is
   * awaited, a failure is told to the user, and the state is reconciled
   * regardless - if the service cannot say whether a call is on, an End Call
   * button that does nothing is the worse of the two options.
   */
  async function endCall(chatObjId: ChatIdObj): Promise<void> {
    try {
      await wrapWithTimeout(
        videoOpenerSrv.endVideoCallInChatRoom(chatObjId),
        END_CALL_TIMEOUT_MILLIS,
        () => Error(`Asking the background service to end the call timed out`),
      );
    } catch (err) {
      log.error(`Failed to end the call in chat ${chatObjId.chatId}`, err);
      $createNotice({
        type: 'error',
        content: t('chat.call.endFailed'),
      });
    } finally {
      await chatsStore.reconcileCallsState();
    }
  }

  /**
   * Rejoin an active call in a group chat.
   * Used when user left the call but other participants are still talking.
   * Clears the isCallActive flag and starts the video call.
   */
  async function rejoinCall(chatObjId: ChatIdObj): Promise<void> {
    await chatsStore.updateChatItemInList(chatObjId, { isCallActive: false });
    await videoOpenerSrv.startVideoCallForChatRoom(chatObjId);
  }

  return {
    startRinging,
    stopRinging,
    toggleRinging,
    joinIncomingCall,
    dismissIncomingCall,
    startCall,
    isStartingCall,
    callsBeingStarted,
    endCall,
    rejoinCall,
  };
});
