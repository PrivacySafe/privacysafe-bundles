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
  import { computed, ComputedRef } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import get from 'lodash/get';
  import size from 'lodash/size';
  import { Ui3nHtml as vUi3nHtml, type Nullable, Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import { prepareDateAsSting } from '@v1nt1248/3nclient-lib/utils';
  import type { OutgoingMessageStatus, RegularMsgView } from '~/index';
  import { useAppStore } from '@main/common/store/app.store';
  import { useContactsStore } from '@main/common/store/contacts.store';
  import { useMessagesStore } from '@main/common/store/messages.store';
  import { useUiOutgoingStore } from '@main/common/store/ui.outgoing.store';
  import { recordingOfAttachments } from '@main/common/utils/chat-ui.helper';
  import ChatMessageStatus from './chat-message-status.vue';
  import ChatMessageAttachments from './chat-message-attachments/chat-message-attachments.vue';
  import ChatMessageReactions from './chat-message-reactions/chat-message-reactions.vue';
  import RecordingQuote from './chat-message-recording/recording-quote.vue';

  const props = defineProps<{
    msg: RegularMsgView;
    wrapMsgElement: Nullable<Element>;
    relatedMessage?: RegularMsgView['relatedMessage'];
    prevMsgSender: string | undefined;
    isProcessing?: boolean;
    isOriginDevice?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'click', value: MouseEvent): void;
  }>();

  const { t } = useI18n();

  const { user: ownAddr, isMobileMode } = storeToRefs(useAppStore());
  const { getContactName } = useContactsStore();
  const { objOfCurrentChatMessages } = storeToRefs(useMessagesStore());
  const { msgsSendingProgress } = storeToRefs(useUiOutgoingStore());

  const chatMsgInfo = computed(() => JSON.stringify([props.msg.chatId.chatId, props.msg.chatMessageId]));

  const isIncomingMsg = computed(() => props.msg.isIncomingMsg);

  const outgoingMsgStatus = computed(() =>
    props.msg.chatMessageType === 'regular' && !isIncomingMsg.value
      ? (props.msg.status as OutgoingMessageStatus)
      : undefined,
  );

  const currentMsgSender = computed<string>(() => props.msg.sender);

  const showSender = computed<boolean>(
    () =>
      props.msg.chatMessageType === 'regular' &&
      isIncomingMsg.value &&
      currentMsgSender.value !== props.prevMsgSender,
  );

  const replyMessage = computed(() => {
    if (!(props.relatedMessage && props.relatedMessage?.replyTo && props.relatedMessage?.replyTo?.chatMessageId)) {
      return null;
    }

    const replyMessageId = props.relatedMessage.replyTo.chatMessageId;
    return get(objOfCurrentChatMessages.value, replyMessageId, null);
  }) as ComputedRef<RegularMsgView | null>;

  /**
   * A recording quoted in a reply is shown as itself - a small frame and what
   * it is - rather than as the generated name it was attached under.
   */
  const replyRecording = computed(() => {
    const quoted = replyMessage.value;
    return (quoted && !quoted.body) ? recordingOfAttachments(quoted.attachments) : undefined;
  });

  const replyMessageText = computed(() => {
    if (!replyMessage.value) { return ''; }

    const body = replyMessage.value.body;
    const attachments = replyMessage.value.attachments;
    const attachmentsText = (attachments || []).map(a => a.name).join(', ');
    return body || `<i>${t('app.text.receive.file')}: ${attachmentsText}</i>`;
  });

  const forwardMessageSender = computed(
    () => props.relatedMessage && props.relatedMessage?.forwardFrom && props.relatedMessage?.forwardFrom?.sender,
  );

  const isMsgChanged = computed(() => {
    const { history = {} } = props.msg;
    const { changes = [] } = history;
    const bodyChanges = changes.filter(i => i.type === 'body');
    return bodyChanges.length > 0;
  });
  const hasMsgReactions = computed(() => size(props.msg.reactions) > 0);

  const isSendingFromOtherDevice = computed(() => {
    if (props.isOriginDevice !== false) {
      return false;
    }

    if (isIncomingMsg.value) {
      return false;
    }

    return outgoingMsgStatus.value === 'sending' || outgoingMsgStatus.value === 'syncing_self';
  });
</script>

<template>
  <div
    :class="[
      $style.chatMessageRegular,
      isMobileMode && $style.chatMessageRegularMobile,
      isIncomingMsg ? $style.incoming : $style.outgoing,
      isProcessing && $style.chatMessageRegularProcessing,
      isSendingFromOtherDevice && $style.fromOtherDevice,
    ]"
    @click="emits('click', $event)"
    @contextmenu="emits('click', $event)"
  >
    <div
      :id="msg.chatMessageId"
      class="chat-message__content"
      :class="$style.content"
    >
      <div :style="{ pointerEvents: 'none' }">
        <h4
          v-if="showSender"
          :class="$style.sender"
        >
          {{ getContactName(msg.sender || ownAddr) }}
        </h4>

        <div
          v-if="replyMessage"
          :class="$style.replyMessage"
        >
          <span :class="$style.replyMessageSender">
            {{ getContactName(replyMessage.sender || ownAddr) }}
          </span>
          <recording-quote
            v-if="replyRecording"
            :msg-id="{ chatId: replyMessage!.chatId, chatMessageId: replyMessage!.chatMessageId }"
            :attachment-name="replyMessage!.attachments![0].name"
            :recording="replyRecording"
          />

          <span
            v-else
            v-ui3n-html:sanitize="{
              dirty: replyMessageText,
              allowedAttributes: { '*': ['class', 'data-mention', 'data-href'] },
            }"
            :class="$style.replyMessageText"
          />
        </div>

        <div
          v-if="forwardMessageSender"
          :class="$style.forwardMessage"
        >
          {{ t('chat.message.label.forward') }}: {{ getContactName(forwardMessageSender) }}
        </div>

        <!-- Skipped when there is no text: an empty <pre> still takes a line's
             height, which put a blank strip above the attachments of every
             message sent without a caption - and a recording is normally sent
             without one. -->
        <pre
          v-if="msg.body"
          v-ui3n-html:sanitize="{
            dirty: msg.body,
            allowedAttributes: { '*': ['class', 'data-mention', 'data-href'] },
          }"
          :class="$style.text"
          :style="{ pointerEvents: 'auto' }"
        />

        <chat-message-attachments
          v-if="msg.attachments?.length"
          :message="msg"
          :is-origin-device="isOriginDevice"
          :is-mobile="isMobileMode"
          :class="$style.chatMessageAttachments"
        />

        <div
          :id="`footer-${msg.chatMessageId}`"
          :class="$style.footer"
        >
          <chat-message-reactions
            :reactions="msg.reactions"
            :is-incoming-msg="isIncomingMsg"
          />

          <div :class="[$style.info, hasMsgReactions && $style.infoWithReactions]">
            <b
              v-if="isMsgChanged"
              :class="$style.infoText"
            >
              {{ t('chat.message.label.changed') }}
            </b>

            <div :class="$style.infoText">
              {{ prepareDateAsSting(msg.timestamp) }}
            </div>

            <chat-message-status
              v-if="!isIncomingMsg"
              :value="outgoingMsgStatus"
              icon-size="12"
            />
          </div>

          <div
            v-if="isSendingFromOtherDevice"
            :class="$style.otherDeviceLabel"
          >
            {{ t('chat.message.label.sending_from_other_device') }}
          </div>
        </div>

        <div
          v-if="msgsSendingProgress[chatMsgInfo]?.progress > 0"
          :class="$style.progress"
        >
          {{ msgsSendingProgress[chatMsgInfo].progress }}%
        </div>
      </div>

      <div
        v-if="isProcessing"
        :class="$style.processing"
      >
        <ui3n-progress-circular
          indeterminate
          size="32"
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss">
  .mention {
    display: inline-block;
    color: var(--color-text-chat-bubble-user-quote-header);
    padding: 2px var(--spacing-xs);
    border-radius: var(--spacing-xs);
    background-color: var(--color-bg-block-tritery-disabled);
  }

  .url {
    display: inline-block;
    color: var(--color-text-chat-bubble-user-quote-header);
  }

  // .w3nUrl {
  //   display: inline-block;
  //   color: var(--color-text-chat-bubble-user-quote-header);
  // }
</style>

<style lang="scss" module>
  .chatMessageRegular {
    --message-max-width: 720px;
    --message-min-width: 112px;

    position: relative;
    width: 90%;
    overflow-wrap: break-word;
    word-break: normal;
    margin: 0 5%;
    display: flex;
    align-items: flex-start;

    &.chatMessageRegularMobile {
      width: 85% !important;
    }

    &.outgoing {
      justify-content: flex-end;

      .content {
        max-width: calc(var(--message-max-width) - 120px);
        background-color: var(--color-bg-chat-bubble-user-default) !important;
      }
    }

    &.incoming {
      justify-content: flex-start;

      .content {
        max-width: calc(var(--message-max-width) - 95px);
        background-color: var(--color-bg-chat-bubble-other-default) !important;
      }
    }

    &.chatMessageRegularProcessing {
      pointer-events: none;
    }

    &.fromOtherDevice {
      opacity: 0.6;

      :global(.chat-message-attachment) {
        pointer-events: none;
        cursor: default;
      }
    }
  }

  .content {
    position: relative;
    min-width: var(--message-min-width);
    border-radius: var(--spacing-s);
    padding: var(--spacing-m) var(--spacing-sm) var(--spacing-s) var(--spacing-sm);
    font-size: var(--font-14);
    color: var(--color-text-chat-bubble-other-default);
    cursor: pointer;
  }

  .sender,
  .forwardMessage {
    font-size: var(--font-13);
    font-weight: 600;
    line-height: var(--font-18);
    margin: 0 0 2px;
  }

  .replyMessage {
    border-top-right-radius: var(--spacing-xs);
    border-bottom-right-radius: var(--spacing-xs);
    border-left: 2px solid var(--color-icon-chat-bubble-other-default);
    padding: var(--spacing-xs) 6px;
    font-size: var(--font-12);
    line-height: var(--font-14);
    color: var(--color-text-control-primary-default);
    background-color: var(--color-bg-chat-bubble-other-quote);
    margin-bottom: var(--spacing-xs);
  }

  .replyMessageSender {
    display: block;
    font-style: italic;
    font-weight: 500;
    margin-bottom: var(--spacing-xs);
  }

  .replyMessageText {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .text {
    font-family: Inter, system-ui, sans-serif;
    font-size: var(--font-14);
    font-weight: 400;
    line-height: var(--font-20);
    margin: 0;
    white-space: pre-wrap;
  }

  .progress {
    position: absolute;
    font-size: var(--font-12);
    font-weight: 500;
    color: var(--color-text-chat-bubble-other-default);
    right: var(--spacing-s);
    top: var(--spacing-xs);
    z-index: 1;
  }

  .chatMessageAttachments {
    margin-top: var(--spacing-s);
  }

  .footer {
    display: flex;
    width: calc(100% + 4px);
    margin-right: -4px;
    justify-content: space-between;
    align-items: flex-start;
    column-gap: var(--spacing-s);
    padding-top: var(--spacing-xs);
  }

  .info {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-xs);

    &.infoWithReactions {
      height: 24px;
    }
  }

  .infoText {
    font-size: var(--font-10);
    line-height: var(--font-12);
    font-weight: 500;
    color: var(--color-text-chat-bubble-other-sub);
  }

  .processing {
    position: absolute;
    inset: 0;
    z-index: 5;
    pointer-events: none;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .otherDeviceLabel {
    display: block;
    font-size: var(--font-11);
    line-height: var(--font-14);
    font-weight: 400;
    font-style: italic;
    color: var(--color-icon-chat-bubble-user-quote);
    margin-top: var(--spacing-xs);
  }
</style>
