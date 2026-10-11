/*
Copyright (C) 2024 - 2026 3NSoft Inc.

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
import { type ComputedRef, inject, nextTick, onMounted, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import isEmpty from 'lodash/isEmpty';
import {
  DIALOGS_KEY,
  DialogsPlugin,
  NOTIFICATIONS_KEY,
  NotificationsPlugin,
  VUEBUS_KEY,
  VueBusPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import type {
  AppGlobalEvents,
  ChatIdObj,
  ChatMessageAction,
  ChatMessageActionType,
  ChatMessageId,
  ChatMessageView,
  OutgoingAttachment,
  RegularMsgView,
} from '~/index';
import { THUMBNAIL_CACHE_KEY, type ThumbnailCache } from '@main/common/composables/useThumbnailCache';
import { copyMessageToClipboard, downloadAttachments } from '@main/common/utils/chat-message-actions.helpers';
import { getMessageActions } from '@main/common/utils/chats.helper';
import { capitalize } from '@v1nt1248/3nclient-lib/utils';
import { useAppStore } from '@main/common/store/app.store';
import { useChatsStore } from '@main/common/store/chats.store';
import { useChatStore } from '@main/common/store/chat.store';
import { useContactsStore } from '@main/common/store/contacts.store';
import { useMessagesStore } from '@main/common/store/messages.store';
import { useUiOutgoingStore } from '@main/common/store/ui.outgoing.store';
import { APP_ROUTES } from '@main/mobile/constants';
import { toCanonicalAddress } from '@shared/address-utils';
import type { ChatMessagesEmits } from './chat-messages.vue';
import MessageDeleteDialog from '@main/common/components/dialogs/message-delete-dialog.vue';
import MessageForwardDialog from '@main/common/components/dialogs/message-forward-dialog.vue';

interface OpenContactCmdArg {
  mail: string;
  name?: string;
}

export default function useChatMessages(
  chatId: ComputedRef<string>,
  readonly: ComputedRef<boolean>,
  emits: ChatMessagesEmits,
) {
  const router = useRouter();

  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const thumbnailCache = inject<ThumbnailCache>(THUMBNAIL_CACHE_KEY)!;

  const { user: ownAddr, isMobileMode, appDeviceId } = storeToRefs(useAppStore());

  const contactsStore = useContactsStore();
  const { contactList } = storeToRefs(contactsStore);
  const chatsStore = useChatsStore();
  const { chatList } = storeToRefs(chatsStore);
  const { createNewOneToOneChat } = chatsStore;
  const chatStore = useChatStore();
  const { currentChatId } = storeToRefs(chatStore);
  const { sendMessageInChat } = chatStore;

  const messagesStore = useMessagesStore();
  const { currentChatMessages, selectedMessages, recentReactions } = storeToRefs(messagesStore);
  const {
    cancelSendingMessage,
    changeMessageReaction,
    getMessageInCurrentChat,
    deleteMessageInChat,
    getMessageAttachments,
    selectMessage,
    addReactionInRecentList,
    loadOlderUntilMessageIsLoaded,
  } = messagesStore;

  const uiOutgoingStore = useUiOutgoingStore();
  const { msgsSendingProgress } = storeToRefs(uiOutgoingStore);
  const { removeRecordFromSendingProgressesList } = uiOutgoingStore;

  const showMessages = ref(false);

  const listElement = useTemplateRef<HTMLDivElement>('list-element');

  const msgActionsMenuProps = ref<{
    open: boolean;
    actions: Omit<ChatMessageAction, 'conditions'>[];
    msg: ChatMessageView | null;
  }>({
    open: false,
    actions: [],
    msg: null,
  });
  const messagesAreProcessing = ref<string[]>([]);

  const msgReactionsMenuProps = ref<{
    open: boolean;
    msg: ChatMessageView | null;
  }>({
    open: false,
    msg: null,
  });

  async function scrollList({ chatId }: AppGlobalEvents['message:sent'], motSmoothly?: boolean) {
    if (listElement.value && currentChatId.value?.chatId === chatId.chatId) {
      await nextTick(() => {
        // Re-read rather than reuse the check above: a tick is long enough for
        // the component to unmount, which empties the template ref.
        listElement.value?.scrollTo({
          top: 1e12,
          left: 0,
          behavior: motSmoothly ? 'auto' : 'smooth',
        });
      });
    }
  }

  function checkIsOriginDevice(msg: ChatMessageView): boolean {
    if (msg.isIncomingMsg) {
      return true;
    }

    if (msg.chatMessageType !== 'regular') {
      return true;
    }
    const msgOwnerDeviceId = msg.settings?.msgOwnersDeviceId;
    if (!msgOwnerDeviceId) {
      return true;
    }
    return msgOwnerDeviceId === appDeviceId.value;
  }

  function openMessageMenu(msg: ChatMessageView | undefined) {
    if (msg && msg.chatMessageType !== 'system' && msg.chatMessageType !== 'invitation') {
      msgActionsMenuProps.value = {
        open: true,
        actions: getMessageActions(msg, t, readonly.value, checkIsOriginDevice(msg)),
        msg,
      };
    }
  }

  function clearMessageMenu() {
    msgActionsMenuProps.value = {
      open: false,
      actions: [] as Omit<ChatMessageAction, 'conditions'>[],
      msg: null,
    };
    msgReactionsMenuProps.value = {
      open: false,
      msg: null,
    };
  }

  function addMsgToProcessingInfoList(chatMessageId: string) {
    if (!messagesAreProcessing.value.includes(chatMessageId)) {
      messagesAreProcessing.value.push(chatMessageId);
    }
  }

  function removeMsgFromProcessingInfoList(chatMessageId: string) {
    const index = messagesAreProcessing.value.indexOf(chatMessageId);
    if (index > -1) {
      messagesAreProcessing.value.splice(index, 1);
    }
  }

  function getMessageFromCurrentChat(chatMessageId: string): RegularMsgView | undefined {
    return currentChatMessages.value.find(m => m.chatMessageId === chatMessageId) as RegularMsgView | undefined;
  }

  function getMessageByElement(ev: MouseEvent): ChatMessageView | undefined {
    const { target } = ev;

    const getMsg = (el: HTMLElement): ChatMessageView | undefined => {
      const { parentElement, classList, id } = el;

      if (!parentElement) {
        return undefined;
      }

      if (classList.contains('chat-message')) {
        return undefined;
      }

      if (classList.contains('chat-message__content') && id) {
        return getMessageFromCurrentChat(id);
      }

      return getMsg(parentElement as HTMLElement);
    };

    return getMsg(target as HTMLElement);
  }

  async function onMsgClick(ev: PointerEvent) {
    if (msgActionsMenuProps.value.open) {
      return;
    }

    const element = ev.target as Nullable<HTMLElement>;

    if (element && element.nodeName === 'A') {
      if (element.classList.contains('mention')) {
        const dataMention = element.dataset.mention;
        if (!dataMention) {
          return;
        }

        const dataMentionSplitted = dataMention.replace('@', '').split('[');
        const user = `${dataMentionSplitted[0]}@${dataMentionSplitted[1]}`.slice(0, -1);
        if (user === ownAddr.value) {
          return;
        }

        const isTargetChatPresent = !!chatList.value.find(chat => chat.chatId === user);

        if (!isTargetChatPresent) {
          const contact = contactList.value.find(c => c.mail === user);
          await createNewOneToOneChat(contact?.displayName || user, toCanonicalAddress(user));
        }

        return await router.push({
          name: APP_ROUTES.CHAT,
          params: {
            chatType: 's',
            chatId: toCanonicalAddress(user),
          },
        });
      }
      if (element.classList.contains('url')) {
        let dataHref = element.dataset.href;
        if (!dataHref) {
          return;
        }

        if (/^w3n:\/\//i.test(dataHref)) {
          const url = new URL(dataHref!);
          const contactCommand = url.hostname;
          const contactAccount = url.searchParams.get('a');
          const contactName = url.searchParams.get('n');

          openContact(contactCommand!, contactAccount!, contactName!);
          return;
        }

        if (!/^https?:\/\//i.test(dataHref)) {
          dataHref = `https://${dataHref}`;
        }

        return w3n.shell!.openURL!(dataHref);
      }

      return;
    }

    const msg = getMessageByElement(ev);

    if (
      msg?.chatMessageType === 'regular' &&
      msg.relatedMessage &&
      msg.relatedMessage.replyTo &&
      msg.relatedMessage.replyTo.chatMessageId
    ) {
      const { chatMessageId } = msg.relatedMessage.replyTo;

      // The original may be older than the loaded page, in which case it has to
      // be pulled in first - otherwise there is no element to scroll to
      const isLoaded = await loadOlderUntilMessageIsLoaded(chatMessageId);
      if (!isLoaded) {
        notifications?.$createNotice({
          type: 'info',
          content: t('chat.message.action_message.error.original_not_reachable'),
        });
        return;
      }

      await nextTick();
      const initialMessageElement = document.getElementById(`msg-${chatMessageId}`);
      initialMessageElement && initialMessageElement.scrollIntoView(false);
    }
  }

  async function openContact(command: string, account: string, name: string) {
    try {
      await w3n.shell!.startAppWithParams!('contacts.app.privacysafe.io', command, {
        mail: account,
        name: name,
      } as OpenContactCmdArg);
    } catch (error) {
      console.log(error);
    }
  }

  function handleClickOnMessagesBlock(ev: MouseEvent) {
    ev.preventDefault();
    ev.stopImmediatePropagation();

    clearMessageMenu();
    nextTick(() => {
      const msg = getMessageByElement(ev);
      openMessageMenu(msg);
    });
  }

  function openReactionDialog(chatMessageId: string) {
    const msg = getMessageInCurrentChat(chatMessageId);
    if (msg && msg.chatMessageType !== 'system' && msg.chatMessageType !== 'invitation') {
      nextTick(() => {
        msgReactionsMenuProps.value = {
          open: true,
          msg,
        };
      });
    }
  }

  async function handleSelectionReaction({
    msg,
    reaction,
  }: {
    msg: ChatMessageView;
    reaction: Nullable<{ id: string; value: string }>;
  }) {
    await changeMessageReaction({ msg, reaction });

    if (!reaction) {
      return;
    }

    addReactionInRecentList(reaction.id);
  }

  async function copyMsgText(chatMessageId: string) {
    const msg = getMessageFromCurrentChat(chatMessageId);
    await copyMessageToClipboard(msg);
    notifications?.$createNotice({
      type: 'success',
      content: t('chat.message.action_message.success.clipboard_copy'),
    });
  }

  async function deleteMsg(chatMessageId: string) {
    const res = await dialog.$openDialog<boolean>(MessageDeleteDialog, {
      dialogProps: {
        title: t('chat.message.dialog.delete.title'),
        ...(isMobileMode.value && { width: 300 }),
        confirmButtonText: capitalize(t('app.text.delete')),
        confirmButtonColor: 'var(--color-text-button-secondary-default)',
        confirmButtonBackground: 'var(--color-bg-button-secondary-default)',
        cancelButtonColor: 'var(--color-text-button-primary-default)',
        cancelButtonBackground: 'var(--color-bg-button-primary-default)',
      },
    });

    const { event, data } = res;
    if (event === 'confirm') {
      addMsgToProcessingInfoList(chatMessageId);
      deleteMessageInChat(chatMessageId, data).finally(() => removeMsgFromProcessingInfoList(chatMessageId));
    }
  }

  function startSelectionMode(chatMessageId: string) {
    selectMessage(chatMessageId);
  }

  function showMsgInfo(chatMessageId: string) {
    const msg = getMessageFromCurrentChat(chatMessageId);
    msg && emits('show:info', msg);
  }

  async function downloadAttachment(chatMessageId: string) {
    const msg = getMessageFromCurrentChat(chatMessageId);
    if (msg?.chatMessageType !== 'regular') {
      return;
    }

    addMsgToProcessingInfoList(chatMessageId);
    console.log('<- 000 ->');
    const res = await downloadAttachments(msg, t).finally(() => removeMsgFromProcessingInfoList(chatMessageId));
    console.log('downloadAttachment res => ', res);

    if (res === undefined) {
      return;
    }

    notifications?.$createNotice({
      type: res ? 'success' : 'error',
      content: res
        ? t('chat.message.action_message.success.file_download')
        : t('chat.message.action_message.error.file_download'),
    });
  }

  function replyMsg(chatMessageId: string) {
    const msg = getMessageFromCurrentChat(chatMessageId);
    msg && emits('reply', msg);
  }

  function editMsg(chatMessageId: string) {
    const msg = getMessageFromCurrentChat(chatMessageId);
    msg && emits('edit', msg);
  }

  async function forwardMsg(chatMessageId: string) {
    const msg = currentChatMessages.value.find(m => m.chatMessageId === chatMessageId) as
      RegularMsgView | undefined;

    if (!msg) {
      return;
    }

    const isOriginDevice = checkIsOriginDevice(msg);
    const hasAttachmentsUnavailable = !isOriginDevice && !isEmpty(msg.attachments) && !msg.isIncomingMsg;

    const chatForForwarding = await dialog.$openDialog<{
      chatId?: ChatIdObj;
      contact?: { mail: string; name: string };
    }>(MessageForwardDialog, {
      dialogProps: {
        title: t('chat.message.dialog.forward.title'),
        ...(isMobileMode.value && { width: 300 }),
        confirmButton: false,
        cancelButton: false,
      },
      ...(hasAttachmentsUnavailable && {
        warningText: t('chat.message.forward.warning.no_attachments'),
      }),
    });

    const { event, data } = chatForForwarding;
    if (event === 'confirm') {
      const { chatId } = data!;

      const shouldLoadAttachments = !hasAttachmentsUnavailable && !isEmpty(msg.attachments);
      const entities: Record<string, web3n.files.ReadonlyFile | web3n.files.ReadonlyFS> = shouldLoadAttachments
        ? await getMessageAttachments(msg.attachments!, msg.incomingMsgId)
        : {};

      // Named by the key rather than by the entity: the entity may be an item
      // of this app's store, whose name is an id, and the forward has to carry
      // the name the attachment had.
      const files: OutgoingAttachment[] = [];
      for (const [name, entity] of Object.entries(entities)) {
        const recording = msg.attachments?.find(a => a.name === name)?.recording;
        if (!recording) {
          files.push({ entity, name });
          continue;
        }
        // The marker travels with the file, or the copy would arrive as a file
        // under a generated name instead of as the voice message it is. Its
        // frame is not on the attachment - it lives in the previews table under
        // the message it came with - so it is read from there and handed over,
        // the way a fresh recording hands over the frame it just took.
        const preview = (recording.kind === 'video')
          ? await thumbnailCache
              .get({ chatId: msg.chatId, chatMessageId: msg.chatMessageId }, name)
              .catch(() => undefined)
          : undefined;
        files.push({ entity, name, recording: { ...recording, ...(preview && { preview }) } });
      }

      await sendMessageInChat({
        chatId: chatId!,
        text: msg.body,
        files: isEmpty(files) ? undefined : files,
        relatedMessage: {
          forwardFrom: {
            sender: msg.sender || ownAddr.value,
          },
        },
        withoutCurrentChatCheck: true,
      });

      await router.push({
        name: APP_ROUTES.CHAT,
        params: {
          chatType: chatId!.isGroupChat ? 'g' : 's',
          chatId: chatId!.chatId,
        },
      });
    }
  }

  async function cancelSending(chatMessageId: string) {
    const msg = currentChatMessages.value.find(m => m.chatMessageId === chatMessageId) as
      RegularMsgView | undefined;
    if (!msg) {
      return;
    }

    const chatMsgInfo = JSON.stringify([msg.chatId.chatId, msg.chatMessageId]);
    const progressData = msgsSendingProgress.value[chatMsgInfo];
    if (!progressData) {
      return;
    }

    const chatMsgId: ChatMessageId = {
      chatId: msg.chatId,
      chatMessageId: chatMessageId,
    };
    await cancelSendingMessage({ deliveryId: progressData.deliveryId, chatMsgId });
    removeRecordFromSendingProgressesList(chatMsgInfo);
  }

  async function resendMsg(chatMessageId: string) {
    const msg = currentChatMessages.value.find(m => m.chatMessageId === chatMessageId) as
      RegularMsgView | undefined;
    if (!msg) {
      return;
    }

    // No attachments are passed: the record of this message already exists, and
    // sending reads its attachments out of the store by the ids that record
    // holds. Handing them over again only made the service store a second copy
    // of every file on each attempt.
    await sendMessageInChat({
      chatId: msg.chatId,
      chatMessageId: msg.chatMessageId,
      text: msg.body,
      files: undefined,
      relatedMessage: undefined,
      withoutCurrentChatCheck: true,
    });
  }

  const messageActions: Partial<Record<ChatMessageActionType, (chatMessageId: string) => void | Promise<void>>> = {
    reaction: openReactionDialog,
    copy: copyMsgText,
    delete_message: deleteMsg,
    select: startSelectionMode,
    info: showMsgInfo,
    download: downloadAttachment,
    reply: replyMsg,
    forward: forwardMsg,
    edit: editMsg,
    resend: resendMsg,
    cancel_sending: cancelSending,
  };

  function handleAction({ action, chatMessageId }: { action: ChatMessageActionType; chatMessageId: string }) {
    const messageAction = messageActions[action];
    if (messageAction) {
      messageAction(chatMessageId);
    }
  }

  /**
   * Kept so unmounting can cancel it: this fires a tenth of a second after a
   * chat is switched to, which is long enough for the user to leave the chat
   * again, and it runs into a component that is no longer there.
   */
  let showMessagesTimerId: ReturnType<typeof setTimeout> | undefined = undefined;

  watch(
    chatId,
    (val, oldVal) => {
      if (val && val !== oldVal) {
        showMessages.value = false;
        messagesAreProcessing.value = [];
        clearTimeout(showMessagesTimerId);
        showMessagesTimerId = setTimeout(() => {
          showMessagesTimerId = undefined;
          showMessages.value = true;
          scrollList({ chatId: currentChatId.value! }, true);
        }, 100);
      }
    },
    {
      immediate: true,
    },
  );

  onMounted(() => {
    emits('init', listElement.value);

    bus.$emitter.on('message:sent', scrollList);
    bus.$emitter.on('message:added', scrollList);
  });

  onBeforeUnmount(() => {
    clearTimeout(showMessagesTimerId);
    bus.$emitter.off('message:sent', scrollList);
    bus.$emitter.off('message:added', scrollList);
  });

  return {
    t,
    showMessages,
    listElement,
    selectedMessages,
    messagesAreProcessing,
    msgActionsMenuProps,
    msgReactionsMenuProps,
    recentReactions,
    selectMessage,
    cancelSending,
    handleClickOnMessagesBlock,
    onMsgClick,
    clearMessageMenu,
    handleAction,
    handleSelectionReaction,
    checkIsOriginDevice,
  };
}
