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
import { computed, inject, provide, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import get from 'lodash/get';
import {
  DIALOGS_KEY,
  type DialogsPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { capitalize } from '@v1nt1248/3nclient-lib/utils';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import type { RegularMsgView } from '~/index';
import { useTaskRunner } from '@main/common/composables/useTaskRunner';
import { THUMBNAIL_CACHE_KEY, useThumbnailCache } from '@main/common/composables/useThumbnailCache';
import { CHAT_STAGE_KEY, useChatStage } from '@main/common/composables/useChatStage';
import { RECORDING_PLAYBACK_KEY, useRecordingPlayback } from '@main/common/composables/useRecordingPlayback';
import { useAppStore } from '@main/common/store/app.store';
import { useContactsStore } from '@main/common/store/contacts.store';
import { useChatStore } from '@main/common/store/chat.store';
import { useMessagesStore } from '@main/common/store/messages.store';
import { chatBlockingStateOf } from '@main/common/utils/chat-ui.helper';
import MessageDeleteDialog from '@main/common/components/dialogs/message-delete-dialog.vue';
import { useChatViewMentions } from '@main/common/composables/useChatViewMentions';
import { useChatViewAttachments } from '@main/common/composables/useChatViewAttachments';
import { useChatViewComposer } from '@main/common/composables/useChatViewComposer';
import { useChatViewMessagesList } from '@main/common/composables/useChatViewMessagesList';
import { useChatViewSearch } from '@main/common/composables/useChatViewSearch';
import { useChatViewRecording } from '@main/common/composables/useChatViewRecording';
import {
  useChatViewRouting,
  type NavigationUtils,
} from '@main/common/composables/useChatViewRouting';

/**
 * The chat screen, assembled from its zones of responsibility.
 *
 * Each zone - mentions, attachments, composer, message list, search, recording,
 * lifecycle - lives in its own composable, and this one is the composition
 * root: it provides the pieces that have to live exactly as long as the view
 * does, wires the zones together over the state they share, and returns the
 * single object the desktop and mobile pages destructure.
 *
 * The other rules of the view - the readonly flag and who is blocked - stay
 * here, because they are read by several zones at once and are a statement
 * about the chat, not about any one of its parts.
 */
export function useChatView(navigationUtils: () => NavigationUtils) {
  const { addTask, cancelTasks } = useTaskRunner();
  provide('task-runner', { addTask });
  // Handed out here so that it lives exactly as long as this view: on a change
  // of chat the map goes with it, and the previous chat's previews cannot show
  // up in the next one.
  provide(THUMBNAIL_CACHE_KEY, useThumbnailCache());
  // The same reasoning for both of these: one recording of the open chat plays
  // at a time, and a video message is shown over the area of this view.
  const recordingPlayback = useRecordingPlayback();
  provide(RECORDING_PLAYBACK_KEY, recordingPlayback);
  const chatStage = useChatStage();
  provide(CHAT_STAGE_KEY, chatStage);

  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY)!;

  const { user, isMobileMode } = storeToRefs(useAppStore());

  const { isBlacklisted } = useContactsStore();

  const chatStore = useChatStore();
  const { currentChat, currentChatId } = storeToRefs(chatStore);

  const messagesStore = useMessagesStore();
  const { currentChatMessages, selectedMessages } = storeToRefs(messagesStore);
  const { clearSelectedMessages, deleteMessagesInChat } = messagesStore;

  // The two refs the composer and the mention list both write into: the text
  // and the input element it is typed into.
  const msgText = ref<string>('');
  const inputEl = ref<Nullable<HTMLTextAreaElement>>(null);

  const msgInfoDisplayed = ref<Nullable<RegularMsgView>>(null);

  const blockingState = computed(() =>
    currentChat.value
      ? chatBlockingStateOf(currentChat.value, isBlacklisted, user.value)
      : { blockedMembers: [], allOthersBlocked: false },
  );
  const blockedMembers = computed(() => blockingState.value.blockedMembers);

  const readonly = computed(() => {
    if (!currentChat.value) {
      return true;
    }

    if (['initiated', 'invited', 'no-members'].includes(currentChat.value.status)) {
      return true;
    }

    if (currentChat.value.isGroupChat && !get(currentChat.value, ['members', user.value, 'hasAccepted'])) {
      return true;
    }

    // Nobody left to write to: the peer of a one-to-one chat is blocked, or
    // every other member of a group is. A group with only some of them blocked
    // stays writable - those are simply struck off the recipients when sending.
    return blockingState.value.allOthersBlocked;
  });

  function setMsgForWhichInfoIsDisplayed(value: Nullable<RegularMsgView>) {
    msgInfoDisplayed.value = value;
  }

  async function deleteMessages() {
    if (!selectedMessages.value.length) {
      return;
    }

    const res = await dialog.$openDialog<boolean>(MessageDeleteDialog, {
      text: t('chat.messages.bulk.delete'),
      dialogProps: {
        title: t('chat.messages.bulk.delete'),
        ...(isMobileMode.value && { width: 300 }),
        confirmButtonText: capitalize(t('app.text.delete')),
        confirmButtonColor: 'var(--color-text-button-secondary-default)',
        confirmButtonBackground: 'var(--color-bg-button-secondary-default)',
        cancelButtonColor: 'var(--color-text-button-primary-default)',
        cancelButtonBackground: 'var(--color-bg-button-primary-default)',
      },
    });

    const { event, data } = res;
    if (event === 'confirm' && currentChatId.value) {
      deleteMessagesInChat(selectedMessages.value, data);
      clearSelectedMessages();
    }
  }

  const mentions = useChatViewMentions({ msgText, inputEl });
  const attachments = useChatViewAttachments({ readonly, inputEl, msgText });
  const composer = useChatViewComposer({
    msgText,
    inputEl,
    readonly,
    files: attachments.files,
    attachmentsInfo: attachments.attachmentsInfo,
    ownedStoredIds: attachments.ownedStoredIds,
    filteredMembers: mentions.filteredMembers,
    activeSuggestionIndex: mentions.activeSuggestionIndex,
    selectMention: mentions.selectMention,
  });
  const messagesList = useChatViewMessagesList();
  const search = useChatViewSearch();
  const recording = useChatViewRecording({
    inputEl,
    recordBtnDisabled: composer.recordBtnDisabled,
    fileTo3nFile: attachments.fileTo3nFile,
    ownedStoredIds: attachments.ownedStoredIds,
  });
  const routing = useChatViewRouting({
    navigationUtils: navigationUtils(),
    cancelTasks,
    recordingPlayback,
    setMsgForWhichInfoIsDisplayed,
    inputEl,
    msgText,
    prepareInfoFromForwardedMessage: composer.prepareInfoFromForwardedMessage,
    onKeydown: mentions.onKeydown,
    ownedStoredIds: attachments.ownedStoredIds,
    discardOwnedStoredItems: attachments.discardOwnedStoredItems,
    takeExternalDraft: attachments.takeExternalDraft,
    messageListElement: messagesList.messageListElement,
    onMessageListScroll: messagesList.onMessageListScroll,
    scrollToFirstUnreadMessage: messagesList.scrollToFirstUnreadMessage,
    resetSearch: search.resetSearch,
  });

  return {
    t,
    currentChat,
    currentChatMessages,
    selectedMessages,
    messageListElement: messagesList.messageListElement,
    whetherShowButtonDown: messagesList.whetherShowButtonDown,
    msgInfoDisplayed,
    disabled: composer.disabled,
    readonly,
    isEmoticonsDialogOpen: composer.isEmoticonsDialogOpen,
    msgText,
    inputEl,
    initialMessage: composer.initialMessage,
    initialMessageType: composer.initialMessageType,
    initialMsgRecording: composer.initialMsgRecording,
    editableMessage: composer.editableMessage,
    files: attachments.files,
    attachmentsInfo: attachments.attachmentsInfo,
    attachmentsTotal: attachments.attachmentsTotal,
    sendBtnDisabled: composer.sendBtnDisabled,
    recordBtnDisabled: composer.recordBtnDisabled,
    mention: mentions.mention,
    filteredMembers: mentions.filteredMembers,
    activeSuggestionIndex: mentions.activeSuggestionIndex,
    blockedMembers,
    blockingState,
    foundMessages: search.foundMessages,
    clearSelectedMessages,
    deleteMessages,
    onInput: mentions.onInput,
    onKeydown: mentions.onKeydown,
    onEscape: composer.onEscape,
    selectMention: mentions.selectMention,
    hideSuggestions: mentions.hideSuggestions,
    onMessageListElementInit: messagesList.onMessageListElementInit,
    setChatStageEl: chatStage.setEl,
    scrollMessageListToEnd: messagesList.scrollMessageListToEnd,
    setMsgForWhichInfoIsDisplayed,
    getTextOfEditableOrInitialMsg: composer.getTextOfEditableOrInitialMsg,
    addFilesViaDnD: attachments.addFilesViaDnD,
    addFiles: attachments.addFiles,
    addFilesViaPaste: attachments.addFilesViaPaste,
    prepareReplyMessage: composer.prepareReplyMessage,
    startEditMsgMode: composer.startEditMsgMode,
    onEmoticonSelect: composer.onEmoticonSelect,
    clearInitialInfo: composer.clearInitialInfo,
    clearAttachments: attachments.clearAttachments,
    finishEditMsgMode: composer.finishEditMsgMode,
    deleteAttachment: attachments.deleteAttachment,
    openMediaRecorder: recording.openMediaRecorder,
    sendMessage: composer.sendMessage,
    setFoundMessages: search.setFoundMessages,
    scrollToMessage: search.scrollToMessage,

    doAfterMount: routing.doAfterMount,
    doBeforeRouteUpdate: routing.doBeforeRouteUpdate,
    doBeforeUnMount: routing.doBeforeUnMount,
  };
}
