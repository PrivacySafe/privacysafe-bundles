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
import { computed, type ComputedRef, inject, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import {
  DIALOGS_KEY,
  DialogsPlugin,
  NOTIFICATIONS_KEY,
  NotificationsPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { capitalize, prepareDateAsSting } from '@v1nt1248/3nclient-lib/utils';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { areChatIdsEqual } from '@shared/chat-ids';
import { toCanonicalAddress } from '@shared/address-utils';
import { exportChatMessages } from '@main/common/utils/chats.helper';
import { useAppStore } from '@main/common/store/app.store';
import { useContactBlocking } from '@main/common/composables/useContactBlocking';
import { useForceRefreshChat } from '@main/common/composables/useForceRefreshChat';
import { useUiIncomingStore } from '@main/common/store/ui.incoming.store';
import { useChatsStore } from '@main/common/store/chats.store';
import { useChatStore } from '@main/common/store/chat.store';
import { useMessagesStore } from '@main/common/store/messages.store';
import { chatService } from '@main/common/services/external-services';
import { ChatListItemView, ChatMessageView, SingleChatView } from '~/chat.types';
import ConfirmationDialog from '@main/common/components/dialogs/confirmation-dialog.vue';
import ChatRenameDialog from '@main/common/components/dialogs/chat-rename-dialog.vue';
import ChatInfoDialog from '@main/common/components/dialogs/chat-info-dialog/chat-info-dialog.vue';
import ManageBlocksDialog from '@main/common/components/dialogs/manage-blocks-dialog/manage-blocks-dialog.vue';

interface ChatActionHandlers {
  history: {
    export: () => Promise<void>;
    clean: () => Promise<void>;
  };
  chat: {
    info: () => Promise<void> | void;
    refresh: () => Promise<void>;
    rename: () => Promise<void> | void;
    close: () => Promise<void>;
    delete: () => Promise<void> | void;
    timer: (id: string) => void;
    leave: () => Promise<void> | void;
  };
  contact: {
    block: () => Promise<void>;
    unblock: () => Promise<void>;
    'manage-blocks': () => Promise<void>;
  };
}

export function useChatHeader({
  chat,
  messages,
  goToChats,
  isMobileMode,
}: {
  chat: ComputedRef<ChatListItemView>;
  messages: ComputedRef<ChatMessageView[]>;
  goToChats: () => Promise<void>;
  isMobileMode?: boolean;
}) {
  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const notification = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const { user } = storeToRefs(useAppStore());

  const { runContactBlocking } = useContactBlocking();
  const { forceRefreshChat } = useForceRefreshChat();

  const uiIncomingStore = useUiIncomingStore();
  const { joinIncomingCall, dismissIncomingCall, startCall, endCall, rejoinCall } = uiIncomingStore;
  /**
   * True from the click until the call window exists. The window takes
   * seconds to appear, and a button that looks untouched for that long gets
   * pressed again (2026-09-11).
   */
  const isStartingCall = computed(() => uiIncomingStore.isStartingCall(chat.value));
  const { refreshChatList } = useChatsStore();

  const chatStore = useChatStore();
  const { currentChatId, currentChat } = storeToRefs(chatStore);
  const { resetCurrentChat, renameChat, deleteChat } = chatStore;

  const messagesStore = useMessagesStore();
  const { deleteAllMessagesInChat } = messagesStore;

  const text = computed<string>(() => {
    if (!chat.value.lastMsg) {
      return '';
    }
    return prepareDateAsSting(chat.value.lastMsg.timestamp);
  });

  const isGroupChat = computed(() => chat.value.isGroupChat);
  const currentChatObjId = computed(() => ({ isGroupChat: isGroupChat.value, chatId: chat.value.chatId }));
  const isIncomingCall = computed(
    () => !!chat.value.incomingCall && !!chat.value.incomingCall.chatId && !!chat.value.incomingCall.peerAddress,
  );
  const chatWithCall = computed(() => !!chat.value.callStart);
  const isCallActive = computed(() => !!chat.value.isCallActive);

  const callDuration = ref<Nullable<string>>(null);
  const timer = ref<NodeJS.Timeout | undefined>(undefined);

  function calculateCallDuration() {
    const diffInMinutes = Math.round((Date.now() - chat.value.callStart!) / 1000 / 60);
    const h = String(Math.floor(diffInMinutes / 60)).padStart(2, '0');
    const m = String(diffInMinutes % 60).padStart(2, '0');
    return `${h}:${m}`;
  }

  async function runChatHistoryExporting() {
    const result = await exportChatMessages({
      t,
      ownAddr: user.value!,
      chat: chat.value,
      messages: messages.value,
    });
    if (result !== undefined) {
      notification.$createNotice({
        type: result ? 'success' : 'error',
        content: result
          ? t('chat.app_message.success.export', { file: `${chat.value?.name}.txt` })
          : t('chat.app_message.error.export', { file: `${chat.value?.name}.txt` }),
      });
    }
  }

  async function runChatHistoryCleaning() {
    const res = await dialog.$openDialog<boolean>(ConfirmationDialog, {
      dialogProps: {
        title: t('chat.dialog.clean_history.title'),
        ...(isMobileMode && { width: 300 }),
      },
    });

    const { event } = res;
    if (event === 'confirm') {
      await deleteAllMessagesInChat(chat.value);
    }
  }

  async function openChatInfoDialog() {
    await dialog.$openDialog<void>(ChatInfoDialog, {
      chat: chat.value,
      isMobileMode,
      dialogProps: {
        title: t('chat.dialog.info.title'),
        ...(isMobileMode && { width: 300 }),
        confirmButton: false,
        cancelButton: false,
      },
    });
  }

  async function runChatRenaming() {
    const res = await dialog.$openDialog<{ oldName: string; newName: string }>(ChatRenameDialog, {
      chatName: chat.value.name,
      dialogProps: {
        title: t('chat.dialog.rename.title'),
        ...(isMobileMode && { width: 300 }),
        confirmButtonText: t('chat.dialog.rename.btn'),
      },
    });

    const { event, data } = res;
    if (event === 'confirm' && data) {
      const { oldName, newName } = data;
      if (newName !== oldName) {
        await renameChat(chat.value, newName);
      }
    }
  }

  async function closeChat() {
    resetCurrentChat();
    await goToChats();
  }

  async function runChatDeleting() {
    const res = await dialog.$openDialog<boolean>(ConfirmationDialog, {
      dialogText: t('chat.dialog.delete.text', { chatName: `<b>${chat.value.name}</b>` }),
      dialogProps: {
        title: t('chat.dialog.delete.title'),
        ...(isMobileMode && { width: 300 }),
        confirmButtonText: capitalize(t('chat.dialog.delete.btn')),
        confirmButtonBackground: 'var(--warning-content-default)',
      },
    });

    const { event } = res;
    if (event === 'confirm') {
      await deleteChat(chat.value, false);
      if (areChatIdsEqual(currentChatId.value, chat.value)) {
        resetCurrentChat();
        await goToChats();
      }
      await refreshChatList();
    }
  }

  async function setMessagesAutoDelete(autoDeleteMessageId: string) {
    if (!autoDeleteMessageId) {
      return;
    }

    const { settings } = currentChat.value!;
    const currentAutoDeleteMessagesId = settings?.autoDeleteMessages || '0';
    if (currentAutoDeleteMessagesId !== autoDeleteMessageId) {
      await chatService.chatSetUp(currentChatId.value!, {
        autoDeleteMessages: autoDeleteMessageId,
      });
    }
  }

  async function setUpContactBlocking(value: boolean) {
    // Group chats have no such menu item: which of the many members it would
    // be about has no answer in a header.
    if (isGroupChat.value) {
      return;
    }

    const currentChatParticipant = toCanonicalAddress((currentChat.value as SingleChatView).peerAddr.toLowerCase());
    await runContactBlocking(currentChatParticipant, value);
  }

  function blockContactInOTOChat() {
    return setUpContactBlocking(true);
  }

  function unblockContactInOTOChat() {
    return setUpContactBlocking(false);
  }

  async function openManageBlocksDialog() {
    // A one-to-one chat has the plain Block/Unblock item instead.
    if (!isGroupChat.value) {
      return;
    }

    await dialog.$openDialog<void>(ManageBlocksDialog, {
      chat: chat.value,
      isMobileMode,
      dialogProps: {
        title: t('chat.dialog.manage_blocks.title'),
        ...(isMobileMode && { width: 300 }),
        confirmButton: false,
        cancelButton: false,
      },
    });
  }

  const actionsHandlers: ChatActionHandlers = {
    history: {
      export: runChatHistoryExporting,
      clean: runChatHistoryCleaning,
    },
    chat: {
      info: openChatInfoDialog,
      refresh: forceRefreshChat,
      rename: runChatRenaming,
      close: closeChat,
      delete: runChatDeleting,
      timer: setMessagesAutoDelete,
      leave: runChatDeleting,
    },
    contact: {
      block: blockContactInOTOChat,
      unblock: unblockContactInOTOChat,
      'manage-blocks': openManageBlocksDialog,
    },
  };

  async function selectAction(compositeAction: string) {
    const [entity, action, value] = compositeAction.split(':');
    // @ts-expect-error
    const handler: (value?: string) => Promise<void> | void = actionsHandlers[entity]?.[action];
    if (handler) {
      await handler(value);
    } else {
      throw new Error(`No handler found for action ${action} on entity ${entity}`);
    }
  }

  onBeforeUnmount(() => {
    timer.value && clearInterval(timer.value);
    timer.value = undefined;
  });

  watch(
    [() => chat.value.chatId, () => chatWithCall.value],
    ([newChatId, newFlagVal], [oldChatId, oldFlagVal]) => {
      if (
        (newChatId === oldChatId && newFlagVal !== oldFlagVal) ||
        (newChatId !== oldChatId && newFlagVal !== oldFlagVal) ||
        (newChatId !== oldChatId && newFlagVal === oldFlagVal)
      ) {
        if (newFlagVal) {
          timer.value && clearInterval(timer.value);
          timer.value = setInterval(() => {
            callDuration.value = calculateCallDuration();
          }, 2000);
        } else {
          timer.value && clearInterval(timer.value);
          timer.value = undefined;
        }
      }
    },
    {
      immediate: true,
    },
  );

  return {
    t,
    text,
    isGroupChat,
    currentChatObjId,
    isIncomingCall,
    chatWithCall,
    isCallActive,
    callDuration,
    selectAction,
    joinIncomingCall,
    dismissIncomingCall,
    startCall,
    isStartingCall,
    endCall,
    rejoinCall,
  };
}
