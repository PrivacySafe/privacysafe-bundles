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
import { computed, ref, toRaw, type ComputedRef, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import size from 'lodash/size';
import isEmpty from 'lodash/isEmpty';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import type {
  ChatMessageAttachmentsInfo,
  ChatMessageId,
  ChatMessageView,
  OutgoingAttachment,
  RegularMsgView,
  RelatedMessage,
  Ui3nTextEnterEvent,
} from '~/index';
import { useChatStore } from '@main/common/store/chat.store';
import { useMessagesStore } from '@main/common/store/messages.store';
import { prepareMessageBody, restoreRawMessage } from '@main/common/utils/chats.helper';
import { recordingExcerpt, recordingOfAttachments } from '@main/common/utils/chat-ui.helper';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ChatViewComposer');

function packRelatedMessageToSend(msg: ChatMessageView, relationType: 'reply' | 'forward'): RelatedMessage {
  switch (relationType) {
    case 'reply': {
      return {
        replyTo: {
          chatMessageId: msg.chatMessageId,
        },
      };
    }

    default:
      throw new Error(`Unknown relation type: ${relationType}`);
  }
}

/**
 * What the composer shares with the view around it: the text and the input
 * element it is typed into, the readonly flag, the attachments it sends, and
 * the mention suggestions it defers to while their list is open.
 */
export interface ChatViewComposerDeps {
  msgText: Ref<string>;
  inputEl: Ref<Nullable<HTMLTextAreaElement>>;
  readonly: ComputedRef<boolean>;
  files: Ref<OutgoingAttachment[]>;
  attachmentsInfo: Ref<ChatMessageAttachmentsInfo[] | undefined>;
  ownedStoredIds: Set<string>;
  filteredMembers: ComputedRef<string[]>;
  activeSuggestionIndex: Ref<number>;
  selectMention: (index: number) => void;
}

/**
 * The message composer: the text of a new message, the reply/forward/edit
 * modes it can be in, the send button, and the call that puts the message on
 * its way. Attachments are the attachments zone's; mentions are the mentions
 * zone's, and only the pick is deferred to here.
 */
export function useChatViewComposer({
  msgText,
  inputEl,
  readonly,
  files,
  attachmentsInfo,
  ownedStoredIds,
  filteredMembers,
  activeSuggestionIndex,
  selectMention,
}: ChatViewComposerDeps) {
  const { t } = useI18n();
  const { currentChat, currentChatId } = storeToRefs(useChatStore());
  const { sendMessageInChat, updateEarlySentMessage } = useChatStore();
  const { getChatMessage } = useMessagesStore();

  const disabled = ref(false);
  const initialMessage = ref<Nullable<RegularMsgView>>(null);
  const initialMessageType = ref<'reply' | 'forward'>('reply');
  const editableMessage = ref<Nullable<RegularMsgView>>(null);
  const isEmoticonsDialogOpen = ref(false);

  const sendBtnDisabled = computed<boolean>(() => {
    return !(msgText.value.trim() || attachmentsInfo.value) || disabled.value || readonly.value;
  });

  /**
   * Whether a recording can be started right now.
   *
   * A call in this chat holds the microphone and the camera in the call window,
   * so a recording started here would fail with NotReadableError - refused
   * before it is attempted rather than explained afterwards. Nothing here has
   * to guard the "one recording per message" invariant the wire format relies
   * on: a recording is a message of its own, carrying one attachment.
   */
  const recordBtnDisabled = computed<boolean>(
    () => disabled.value || readonly.value || !!currentChat.value?.isCallActive,
  );

  /**
   * The recording the message being replied to or forwarded consists of, so
   * that the banner can show a frame of it rather than a line of text. Beside
   * getTextOfEditableOrInitialMsg rather than inside it: that one answers with
   * HTML, and a preview has to be read from the previews table.
   */
  const initialMsgRecording = computed(() =>
    initialMessage.value && !initialMessage.value.body
      ? recordingOfAttachments(initialMessage.value.attachments)
      : undefined,
  );

  function getTextOfEditableOrInitialMsg(msg: Nullable<RegularMsgView>) {
    if (!msg) {
      return '';
    }

    const { body, attachments } = msg;
    // A recording being replied to or forwarded reads as what it is, rather
    // than as the generated name it was attached under.
    const recording = recordingOfAttachments(attachments);
    if (!body && recording) {
      return `<i>${recordingExcerpt(recording, t)}</i>`;
    }
    const attachmentsText = (attachments || []).map(a => a.name).join(', ');
    return body || `<i>${t('app.text.receive.file')}: ${attachmentsText}</i>`;
  }

  function onEmoticonSelect(emoticon: { id: string; value: string }) {
    msgText.value += emoticon.value;
  }

  async function prepareInfoFromForwardedMessage(fwdMsgId: ChatMessageId) {
    const msg = await getChatMessage(fwdMsgId);
    if (msg && msg.chatMessageType === 'regular') {
      initialMessageType.value = 'forward';
      initialMessage.value = msg;
      inputEl.value?.focus();
    }
  }

  function clearInitialInfo() {
    initialMessage.value = null;
  }

  function finishEditMsgMode() {
    editableMessage.value = null;
    msgText.value = '';
  }

  function prepareReplyMessage(msg: RegularMsgView) {
    initialMessageType.value = 'reply';
    initialMessage.value = msg;
    inputEl.value?.focus();
  }

  function startEditMsgMode(msg: RegularMsgView) {
    editableMessage.value = msg;
    editableMessage.value.body = restoreRawMessage(msg.body);

    msgText.value = restoreRawMessage(msg.body);
    inputEl.value?.focus();
  }

  function isMsgEmpty() {
    if (!(msgText.value || size(files) > 0)) {
      return true;
    }

    if (size(files.value) > 0) {
      return false;
    }

    if (msgText.value === '\n') {
      msgText.value = '';
      return true;
    }

    return false;
  }

  function onEscape(event: Event) {
    event.preventDefault();
    if (initialMessage.value !== null) {
      return clearInitialInfo();
    }

    if (editableMessage.value !== null) {
      return finishEditMsgMode();
    }

    // TODO ??? Perhaps it's also worth handling the situation when a user enters a mention of another address in
    //  the text.
    // TODO ??? It might also be worthwhile to handle the situation when attachments are attached to a message.
  }

  async function sendMessage(ev?: Ui3nTextEnterEvent, force = false) {
    if (disabled.value || readonly.value || isMsgEmpty()) {
      return;
    }

    if (!isEmpty(filteredMembers.value)) {
      if (activeSuggestionIndex.value >= 0) {
        selectMention(activeSuggestionIndex.value);
        setTimeout(() => {
          const lastCharCode = msgText.value.charCodeAt(msgText.value.length - 1);
          lastCharCode === 10 && (msgText.value = msgText.value.slice(0, -1));
        }, 50);
      }
      return;
    }

    const { shiftKey } = ev ?? { shiftKey: false };

    if (force || (!force && !shiftKey)) {
      if (editableMessage.value && JSON.stringify(editableMessage.value!.body) !== JSON.stringify(msgText.value)) {
        disabled.value = true;

        updateEarlySentMessage({
          chatId: currentChatId.value!,
          chatMessageId: editableMessage.value!.chatMessageId,
          updatedBody: msgText.value ? prepareMessageBody(msgText.value) : '',
        });

        setTimeout(() => {
          msgText.value = '';
          files.value = [];
          attachmentsInfo.value = undefined;
          initialMessage.value = null;
          editableMessage.value = null;
          disabled.value = false;
        }, 400);

        return;
      }

      const relatedMessage = initialMessage.value
        ? packRelatedMessageToSend(initialMessage.value, initialMessageType.value)
        : undefined;
      disabled.value = true;

      msgText.value = msgText.value ? prepareMessageBody(msgText.value) : '';

      sendMessageInChat({
        chatId: toRaw(currentChatId.value!),
        text: (msgText.value || '').trim(),
        files: toRaw(files.value),
        relatedMessage,
      }).catch(e => log.error('Error sending the message.', e));

      // The message owns its attachments from here on: the call above has
      // already taken them, and this composer must not delete their storage
      // items when it is closed.
      ownedStoredIds.clear();

      setTimeout(() => {
        msgText.value = '';
        files.value = [];
        attachmentsInfo.value = undefined;
        initialMessage.value = null;
        editableMessage.value = null;
        disabled.value = false;
      }, 400);
    }
  }

  return {
    disabled,
    initialMessage,
    initialMessageType,
    editableMessage,
    isEmoticonsDialogOpen,
    sendBtnDisabled,
    recordBtnDisabled,
    initialMsgRecording,
    getTextOfEditableOrInitialMsg,
    onEmoticonSelect,
    prepareInfoFromForwardedMessage,
    clearInitialInfo,
    finishEditMsgMode,
    prepareReplyMessage,
    startEditMsgMode,
    isMsgEmpty,
    onEscape,
    sendMessage,
  };
}

export type ChatViewComposer = ReturnType<typeof useChatViewComposer>;
