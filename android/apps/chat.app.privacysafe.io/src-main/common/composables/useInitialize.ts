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
import { shallowRef, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import { chatService, videoOpenerSrv } from '@main/common/services/external-services';
import { useAppStore } from '@main/common/store/app.store';
import { useChatsStore } from '@main/common/store/chats.store';
import { useMessagesStore } from '@main/common/store/messages.store';
import { useBackupStore } from '@main/common/store/backup.store';
import { useContactsStore } from '@main/common/store/contacts.store';
import type { UpdateEvent } from '~/services.types';
import { SingleProc } from '@shared/processes/single';
import { makeLogger } from '@shared/logger';

const log = makeLogger('Initialize');

export function useInitialize() {
  const { t } = useI18n();
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY);
  
  const appStore = useAppStore();
  const chatsStore = useChatsStore();
  const messagesStore = useMessagesStore();
  const backupStore = useBackupStore();

  /** Reported once: it is a misconfiguration, not a passing condition. */
  let duplicateInstanceReported = false;

  const {
    handleBackgroundChatEvents,
    refreshChatList,
    updateChatItemInList,
    getChatView,
    recordCallCancelledByCaller,
  } = chatsStore;
  const { fetchRecentReactions, handleBackgroundMessageEvents } = messagesStore;

  const updatesQueue: UpdateEvent[] = [];
  const updatesProc = new SingleProc();

  const stopMessagesProcessing = shallowRef<(() => void) | undefined>(undefined);
  const stopVideoCallsWatching = shallowRef<(() => void) | undefined>(undefined);

  async function processQueuedUpdateEvents(): Promise<void> {
    while (updatesQueue.length > 0) {
      const event = updatesQueue.shift()!;
      try {
        if (event.updatedEntityType === 'chat') {
          await handleBackgroundChatEvents(event);
        } else if (event.updatedEntityType === 'message') {
          await handleBackgroundMessageEvents(event);
        } else if (event.updatedEntityType === 'bulk') {
          // The chat list first: fetchMessages() reads `unread` to size its
          // first page.
          await refreshChatList();
          await messagesStore.fetchMessages();
          messagesStore.clearSelectedMessages();
          await fetchRecentReactions();
        } else {
          console.info(`Unknown update event from ChatService:`, event);
        }
      } catch (err) {
        log.error('Failed to apply update event from ChatService', err);
      }
    }
  }

  async function initialize() {
    await refreshChatList();
    await fetchRecentReactions();

    stopMessagesProcessing.value = chatService.watch({
      next: updateEvent => {
        // FIRST, before anything else: the final `else` below logs every event
        // it does not recognize, and these tick many times a second.
        //
        // Applied straight away rather than queued, for the same reason
        // 'sync-state' is (see the note just below): the queue is drained by a
        // SingleProc in which every event does database and IPC work, and a
        // progress bar that lags behind by seconds is not a progress bar. The
        // progress of a restore is if anything more sensitive to it - the
        // restore is what fills that queue.
        if (updateEvent.updatedEntityType === 'backup-progress') {
          backupStore.applyServiceBackupProgress(updateEvent.progress);
          return;
        }
        if (updateEvent.updatedEntityType === 'restore-progress') {
          backupStore.onRestoreProgress(updateEvent.progress);
          return;
        }
        // A restore, and the receipt of a restore snapshot, swallow their
        // per-record events and close with this one instead: everything is
        // re-read rather than patched thousands of times over.
        if (updateEvent.updatedEntityType === 'bulk') {
          updatesQueue.push(updateEvent);
          if (!updatesProc.getP()) {
            updatesProc.start(processQueuedUpdateEvents);
          }
          return;
        }
        // Sync state is applied straight away rather than queued. The queue is
        // drained by a SingleProc, and every chat/message event in it does
        // database and IPC work, so during the very backlog the indicator exists
        // to explain it would lag behind by seconds. Order against the other
        // events does not matter here, and snapshot numbers guard against
        // reordering among sync events themselves.
        if (updateEvent.updatedEntityType === 'sync-state') {
          if (updateEvent.event === 'changed') {
            appStore.applySyncState(updateEvent.state);
          } else if (!duplicateInstanceReported) {
            duplicateInstanceReported = true;
            notifications?.$createNotice({
              type: 'error',
              content: t('app.sync.duplicateInstance'),
              duration: 15000,
            });
          }
          return;
        }
        updatesQueue.push(updateEvent);
        if (!updatesProc.getP()) {
          updatesProc.start(processQueuedUpdateEvents);
        }
      },
      complete: () => console.info(`Observation of updates events from ChatService completed.`),
      error: err => log.error(`Error occurred in observation of updates events from ChatService. `, err),
    });

    // Right after the subscription, not before it: events are only built while a
    // GUI is attached, so a catch-up scan running at this moment would otherwise
    // be invisible until its next state change.
    await appStore.refreshSyncState();

    stopVideoCallsWatching.value = videoOpenerSrv.watchVideoChats({
      next: async data => {
        const { type, chatId } = data;
        switch (type) {
          case 'call-started':
            await updateChatItemInList(chatId, { callStart: Date.now() });
            break;

          // `incomingCall` is cleared here as well: it drives both the
          // Join/Decline buttons and the ringtone (one watcher, in
          // chat-list-item.vue), and a call that is over must leave neither
          // behind. This is also what stops the ringing on a device where the
          // user answered the call on another one of their devices.
          case 'call-ended': {
            // The caller withdrew a call that was only ringing here, so the
            // cancelled call goes into the history as well. Guarded on
            // `incomingCall`: the caller's 'outgoing-call-cancelled' system
            // message reports the same thing on its own delivery, and whichever
            // arrives first is the one that records it.
            if ((data.reason === 'unanswered-here') && getChatView(chatId)?.incomingCall) {
              await recordCallCancelledByCaller(chatId, data.peerAddr);
            }
            await updateChatItemInList(chatId, {
              callStart: undefined,
              isCallActive: false,
              incomingCall: undefined,
            });
            // Said out loud only when the user was already answering here: the
            // call window closed by itself, and without a word that reads as the
            // app losing the call rather than handing it over.
            if (data.reason === 'answered-elsewhere') {
              notifications?.$createNotice({
                type: 'info',
                content: t('chat.notification.callAnsweredElsewhere.message'),
                duration: 5000,
              });
            }
            break;
          }

          case 'call-ended-by-host': {
            await updateChatItemInList(chatId, {
              callStart: undefined,
              isCallActive: false,
              incomingCall: undefined,
            });
            const chat = getChatView(chatId);
            notifications?.$createNotice({
              type: 'info',
              content: `${t('chat.notification.callEndedByHost.title')} \n ${t('chat.notification.callEndedByHost.message', { chatName: chat?.name ?? '' })}`,
              duration: 5000,
            });
            break;
          }

          // Two calls were started in this chat at the same moment. Either ours
          // gave way and the call window that just closed is replaced by the one
          // of the other caller, or theirs never came in - both need saying, as
          // neither explains itself on screen.
          case 'call-collision': {
            const name = data.peerAddr ? useContactsStore().getContactName(data.peerAddr) : '';
            notifications?.$createNotice({
              type: 'info',
              content: (data.collisionOutcome === 'joining')
                ? t('chat.notification.callCollision.joining', { name })
                : t('chat.notification.callCollision.unresolved', { name }),
              duration: (data.collisionOutcome === 'joining') ? 7000 : 15000,
            });
            break;
          }

          case 'call-active':
            await updateChatItemInList(chatId, { isCallActive: data.isCallActive });
            // Show notification when call becomes active and user is not in the
            // call. Skipped when we ourselves just left that call: the re-join
            // button is enough, a "call is active" notice would be noise.
            if (data.isCallActive && data.reason !== 'self-left') {
              const chat = getChatView(chatId);
              if (chat && !chat.callStart) {
                notifications?.$createNotice({
                  type: 'info',
                  content: `${t('chat.notification.callActive.title')} \n ${t('chat.notification.callActive.message', { chatName: chat.name })}`,
                });
              }
            }
            break;

          // no default
        }
      },
      complete: () => console.info('Observation of video call events from VideoOpenerService completed.'),
      error: err =>
        log.error('Error occurred in observation of video call events from VideoOpenerService. ', err),
    });

    // After the subscription, for the same reason refreshSyncState() is (see
    // above): subscribe first, then ask, so nothing falls into the gap.
    //
    // This is what a window that missed the events catches up with - one
    // opened in the middle of a call, which never knew about it at all, and
    // one whose background component went quiet mid-call and left call state
    // that no event was ever going to clear.
    await chatsStore.reconcileCallsState();
  }

  return {
    stopMessagesProcessing,
    stopVideoCallsWatching,
    initialize,
  };
}
