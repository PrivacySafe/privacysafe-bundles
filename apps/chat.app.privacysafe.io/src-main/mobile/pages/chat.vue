<!--
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
-->
<script lang="ts" setup>
  import { computed, onBeforeUnmount, onMounted } from 'vue';
  import { onBeforeRouteUpdate } from 'vue-router';
  import { storeToRefs } from 'pinia';
  import isEmpty from 'lodash/isEmpty';
  import { Ui3nButton, Ui3nHtml, Ui3nIcon, Ui3nText, Ui3nTooltip, Ui3nClickOutside } from '@v1nt1248/3nclient-lib';
  import { formatFileSize } from '@v1nt1248/3nclient-lib/utils';
  import type { RegularMsgView } from '~/index';
  import { useChatView } from '@main/common/composables/useChatView';
  import { useAppStore } from '@main/common/store/app.store';
  import { useContactsStore } from '@main/common/store/contacts.store';
  import { useNavigation } from '@main/mobile/composables/useNavigation';
  import { useChatPullToRefresh } from '@main/mobile/composables/useChatPullToRefresh';
  import ChatHeader from '@main/mobile/components/chat/chat-header.vue';
  import EmoticonsDialog from '@main/common/components/dialogs/emoticons-dialog.vue';
  import ChatAttachmentItem from '@main/common/components/chat/chat-attachment-item.vue';
  import ChatMessages from '@main/common/components/messages/chat-messages/chat-messages.vue';
  import ChatMessageInfo from '@main/common/components/messages/chat-message/chat-message-info/chat-message-info.vue';
  import ChatAvatar from '@main/common/components/chat/chat-avatar.vue';
  import RecordingQuote from '@main/common/components/messages/chat-message/chat-message-recording/recording-quote.vue';

  const vUi3nHtml = Ui3nHtml;
  const vUi3nClickOutside = Ui3nClickOutside;

  const { getContactName } = useContactsStore();
  const { canRecord } = storeToRefs(useAppStore());

  const {
    t,
    currentChat,
    currentChatMessages,
    selectedMessages,
    whetherShowButtonDown,
    msgInfoDisplayed,
    disabled,
    readonly,
    isEmoticonsDialogOpen,
    msgText,
    inputEl,
    initialMessage,
    initialMessageType,
    initialMsgRecording,
    editableMessage,
    files,
    attachmentsInfo,
    attachmentsTotal,
    sendBtnDisabled,
    recordBtnDisabled,
    filteredMembers,
    activeSuggestionIndex,
    blockedMembers,
    blockingState,
    messageListElement,
    onInput,
    selectMention,
    hideSuggestions,
    clearSelectedMessages,
    onMessageListElementInit,
    setChatStageEl,
    deleteMessages,
    scrollMessageListToEnd,
    setMsgForWhichInfoIsDisplayed,
    getTextOfEditableOrInitialMsg,
    addFiles,
    addFilesViaPaste,
    prepareReplyMessage,
    startEditMsgMode,
    onEmoticonSelect,
    clearInitialInfo,
    clearAttachments,
    finishEditMsgMode,
    deleteAttachment,
    openMediaRecorder,
    sendMessage,
    doAfterMount,
    doBeforeRouteUpdate,
    doBeforeUnMount,
  } = useChatView(useNavigation);

  useChatPullToRefresh(messageListElement, computed(() => blockingState.value.allOthersBlocked));

  onMounted(doAfterMount);
  onBeforeRouteUpdate(doBeforeRouteUpdate);
  onBeforeUnmount(doBeforeUnMount);
</script>

<template>
  <div :class="$style.chat">
    <chat-header
      v-if="currentChat"
      :chat="currentChat!"
      :messages="currentChatMessages"
      :blocking-state="blockingState"
      :readonly="readonly"
    />

    <div :class="$style.bodyWrapper">
      <div :class="$style.messagesWrapper">
        <div :class="$style.messages">
          <chat-messages
            v-if="currentChatMessages && currentChat"
            :chat="currentChat!"
            :messages="currentChatMessages"
            :blocked-members="blockedMembers"
            :readonly="readonly"
            @init="onMessageListElementInit"
            @reply="prepareReplyMessage"
            @edit="startEditMsgMode"
            @show:info="setMsgForWhichInfoIsDisplayed"
          />

          <ui3n-button
            v-if="whetherShowButtonDown"
            type="icon"
            color="transparent"
            icon="round-keyboard-arrow-down"
            icon-size="30"
            icon-color="var(--color-icon-block-accent-default)"
            :class="$style.btnDown"
            @click.stop.prevent="scrollMessageListToEnd"
          />
        </div>
      </div>

      <div :class="$style.actions">
        <div
          v-show="selectedMessages.length === 0"
          :class="$style.input"
        >
          <div :class="$style.emoticonsBtnWrapper">
            <ui3n-button
              type="icon"
              color="var(--color-bg-block-primary-default)"
              icon="outline-insert-emoticon"
              icon-size="24"
              icon-color="var(--color-icon-block-secondary-default)"
              :disabled="disabled || readonly"
              @click.stop.prevent="isEmoticonsDialogOpen = !isEmoticonsDialogOpen"
            />

            <emoticons-dialog
              :open="isEmoticonsDialogOpen"
              @close="isEmoticonsDialogOpen = false"
              @select="onEmoticonSelect"
            />
          </div>

          <ui3n-button
            type="icon"
            color="var(--color-bg-block-primary-default)"
            icon="round-attach-file"
            icon-size="24"
            icon-color="var(--color-icon-block-secondary-default)"
            :disabled="disabled || readonly"
            @click="addFiles"
          />

          <div
            :class="$style.inputField"
            @paste="addFilesViaPaste"
          >
            <ui3n-text
              v-model="msgText"
              :rows="1"
              :max-rows="3"
              :disabled="readonly"
              @init="inputEl = $event"
              @input="onInput"
              @enter="sendMessage($event)"
            />
          </div>

          <ui3n-button
            v-if="canRecord"
            type="icon"
            color="var(--color-bg-block-primary-default)"
            icon="outline-voice-chat"
            icon-size="24"
            icon-color="var(--color-icon-block-secondary-default)"
            :disabled="recordBtnDisabled"
            @click="openMediaRecorder"
          />

          <ui3n-button
            type="icon"
            color="var(--color-bg-block-primary-default)"
            icon="round-send"
            icon-size="24"
            :icon-color="
              !sendBtnDisabled
                ? 'var(--color-icon-block-accent-default)'
                : 'var(--color-icon-block-secondary-default)'
            "
            :disabled="sendBtnDisabled"
            @click="sendMessage(undefined, true)"
          />

          <div :class="$style.inputAdditional">
            <div
              v-if="initialMessage"
              :class="$style.inputAdditionalBlock"
            >
              <div :class="$style.inputAdditionalIcon">
                <ui3n-icon
                  icon="outline-reply"
                  width="24"
                  height="24"
                  :horizontal-flip="initialMessageType === 'forward'"
                  color="var(--color-icon-block-accent-default)"
                />
              </div>

              <div :class="$style.inputAdditionalData">
                <div :class="$style.inputAdditionalLabel">
                  {{ getContactName((initialMessage as RegularMsgView).sender) }}
                </div>

                <recording-quote
                  v-if="initialMsgRecording"
                  :msg-id="{
                    chatId: (initialMessage as RegularMsgView).chatId,
                    chatMessageId: (initialMessage as RegularMsgView).chatMessageId,
                  }"
                  :attachment-name="(initialMessage as RegularMsgView).attachments![0].name"
                  :recording="initialMsgRecording"
                />

                <div
                  v-else
                  v-ui3n-html:sanitize="getTextOfEditableOrInitialMsg(initialMessage)"
                  :class="$style.inputAdditionalText"
                />
              </div>

              <ui3n-button
                :class="$style.attachmentsClear"
                type="icon"
                color="transparent"
                size="small"
                icon="round-close"
                icon-size="16"
                icon-color="var(--color-icon-control-secondary-default)"
                @click="clearInitialInfo"
              />
            </div>

            <div
              v-if="editableMessage"
              :class="$style.inputAdditionalBlock"
            >
              <div :class="$style.inputAdditionalIcon">
                <ui3n-icon
                  icon="outline-edit"
                  width="24"
                  height="24"
                  color="var(--color-icon-block-accent-default)"
                />
              </div>

              <div :class="$style.inputAdditionalData">
                <div :class="$style.inputAdditionalLabel">
                  {{ t('chat.message.label.edit') }}
                </div>
                <div
                  v-ui3n-html:sanitize="getTextOfEditableOrInitialMsg(editableMessage)"
                  :class="$style.inputAdditionalText"
                />
              </div>

              <ui3n-button
                :class="$style.attachmentsClear"
                type="icon"
                color="transparent"
                size="small"
                icon="round-close"
                icon-size="16"
                icon-color="var(--color-icon-control-secondary-default)"
                @click="finishEditMsgMode"
              />
            </div>

            <div
              v-if="!isEmpty(filteredMembers)"
              v-ui3n-click-outside="hideSuggestions"
              :class="$style.members"
            >
              <div
                v-for="(member, index) in filteredMembers"
                :key="member"
                :class="[$style.member, index === activeSuggestionIndex && $style.active]"
                @click.stop.prevent="selectMention(index)"
              >
                <chat-avatar
                  size="24"
                  :name="member"
                />
                {{ member }}
              </div>
            </div>

            <div
              v-if="!isEmpty(attachmentsInfo)"
              :class="$style.attachments"
            >
              <div :class="$style.attachmentsStat">
                {{ t('chat.total') }}: {{ formatFileSize(attachmentsTotal) }}
              </div>

              <div :class="$style.attachmentsBody">
                <chat-attachment-item
                  v-for="(attachmentInfo, index) in attachmentsInfo!"
                  :key="`${attachmentInfo.name}-${attachmentInfo.id || ''}`"
                  :info="attachmentInfo"
                  :entity="files[index].entity"
                  @change:size="attachmentInfo.size = $event"
                  @delete="deleteAttachment(index)"
                />
              </div>

              <ui3n-button
                type="icon"
                color="transparent"
                icon="round-close"
                icon-size="16"
                icon-color="#828282"
                :class="$style.attachmentsClear"
                @click="clearAttachments"
              />
            </div>
          </div>
        </div>

        <div
          v-show="selectedMessages.length > 0"
          :class="$style.bulkActions"
        >
          <ui3n-tooltip
            :content="t('chat.messages.bulk.delete')"
            placement="top-start"
            position-strategy="fixed"
          >
            <ui3n-button
              type="icon"
              color="var(--color-bg-block-primary-default)"
              icon="outline-delete"
              icon-size="24"
              icon-color="var(--error-content-default)"
              :disabled="selectedMessages.length === 0"
              @click.stop.prevent="deleteMessages"
            />
          </ui3n-tooltip>

          <div :class="$style.selectedText">
            {{ t('chat.messages.selected') }}:&nbsp;{{ selectedMessages.length }}
          </div>

          <ui3n-tooltip
            :content="t('chat.messages.bulk.exit')"
            placement="top-end"
            position-strategy="fixed"
          >
            <ui3n-button
              type="icon"
              color="var(--color-bg-block-primary-default)"
              icon="round-close"
              icon-size="24"
              icon-color="var(--color-icon-block-secondary-default)"
              @click.stop.prevent="clearSelectedMessages"
            />
          </ui3n-tooltip>
        </div>
      </div>

      <!-- Where a video message is played, so that it is bounded by the chat
           rather than by the window. Transparent to clicks until something is
           shown on it. -->
      <div
        :ref="setChatStageEl"
        :class="$style.recordingStage"
      />
    </div>

    <chat-message-info
      :msg="msgInfoDisplayed"
      @close="setMsgForWhichInfoIsDisplayed(null)"
    />
  </div>
</template>

<style lang="scss" module>
  @use '@main/common/assets/styles/_mixins.scss' as mixins;

  .chat {
    --chat-toolbar-height: 64px;
    --chat-input-max-height: 88px;

    position: fixed;
    inset: 0;
  }

  .bodyWrapper {
    position: relative;
    width: 100%;
    height: calc(100% - var(--chat-toolbar-height));
    background-color: var(--color-bg-chat-bubble-general-bg);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: stretch;
    row-gap: var(--spacing-xs);
  }

  .recordingStage {
    position: absolute;
    inset: 0;
    z-index: 10;
    pointer-events: none;
  }

  .messagesWrapper {
    position: relative;
    width: 100%;
    flex-basis: calc(100% - var(--chat-toolbar-height) - var(--spacing-xs));
    overflow-y: auto;
  }

  .messages {
    position: relative;
    width: 100%;
    height: calc(100% - 4px);
  }

  .actions {
    position: relative;
    width: 100%;
    flex-grow: 1;
  }

  .input {
    position: relative;
    width: 100%;
    display: flex;
    padding: var(--spacing-s);
    justify-content: center;
    align-items: center;
    max-height: var(--chat-input-max-height);
    flex-grow: 1;
    background-color: var(--color-bg-block-primary-default);
  }

  .emoticonsBtnWrapper {
    position: relative;
  }

  .inputField {
    position: relative;
    width: 55%;
    margin: 0 var(--spacing-m);
  }

  .inputAdditional {
    position: absolute;
    background-color: var(--color-bg-block-primary-default);
    left: 0;
    width: 100%;
    bottom: calc(100% + 1px);
  }

  .attachments {
    position: relative;
    width: 100%;
    padding: var(--spacing-ml) var(--spacing-m) var(--spacing-xs);
    overflow: hidden;
  }

  .attachmentsStat {
    position: absolute;
    left: var(--spacing-m);
    top: var(--spacing-xs);
    height: var(--spacing-m);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    font-size: var(--font-13);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
  }

  .attachmentsBody {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-xs);
    padding-bottom: var(--spacing-xs);
    overflow-x: auto;

    @include mixins.scrollbar-horizontal(96px);
  }

  .attachmentsClear {
    position: absolute !important;
    top: 0;
    right: 4px;
  }

  /* min-height rather than height: a quoted recording puts a 32px frame on the
     second line, and a fixed height would clip it. */
  .inputAdditionalBlock {
    display: flex;
    min-height: var(--spacing-xl);
    padding: var(--spacing-xs) 2px var(--spacing-xs) var(--spacing-s);
    justify-content: flex-start;
    align-items: center;
  }

  .members {
    position: relative;
    width: 100%;
  }

  .member {
    position: relative;
    width: 100%;
    height: var(--spacing-l);
    padding: 0 var(--spacing-m);
    border-radius: var(--spacing-s);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    font-size: var(--font-12);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
    cursor: pointer;

    &.active,
    &:hover {
      background-color: var(--color-bg-block-primary-hover);
    }
  }

  .inputAdditionalIcon {
    position: relative;
    min-width: var(--spacing-l);
    width: var(--spacing-l);
    min-height: var(--spacing-l);
    height: var(--spacing-l);
    display: flex;
    justify-content: center;
    align-items: center;
    border-right: 3px solid var(--color-icon-block-accent-default);
  }

  .inputAdditionalData {
    position: relative;
    width: calc(100% - var(--spacing-s) * 7);
    padding: 0 var(--spacing-xs);
  }

  .inputAdditionalLabel {
    position: relative;
    width: 100%;
    font-size: var(--font-12);
    font-weight: 500;
    line-height: var(--font-16);
    color: var(--color-icon-block-accent-default);
  }

  .inputAdditionalText {
    position: relative;
    font-size: var(--font-12);
    font-weight: 400;
    line-height: var(--font-16);
    color: var(--color-text-chat-bubble-other-quote);
    @include mixins.text-overflow-ellipsis();
  }

  .bulkActions {
    position: relative;
    width: 100%;
    height: 66px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-m);
    background-color: var(--color-bg-block-primary-default);
  }

  .selectedText {
    font-size: var(--font-16);
    color: var(--color-text-block-secondary-default);
  }

  .btnDown {
    position: absolute;
    bottom: 8px;
    right: 8px;
    border: 1px solid var(--color-icon-block-accent-default);
  }
</style>
