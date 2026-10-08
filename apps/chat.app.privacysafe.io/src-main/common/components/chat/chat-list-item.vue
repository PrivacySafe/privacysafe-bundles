<!--
 Copyright (C) 2020 - 2025 3NSoft Inc.

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
  import { computed, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import dayjs from 'dayjs';
  import { prepareDateAsSting } from '@v1nt1248/3nclient-lib/utils';
  import { Ui3nBadge, Ui3nButton, Ui3nIcon, Ui3nHtml } from '@v1nt1248/3nclient-lib';
  import {
    blockingIconFor,
    chatBlockingStateOf,
    getChatNameHint,
    getTextForChatInvitationMessage,
    getTextForChatSystemMessage,
    recordingExcerpt,
    recordingOfAttachments,
  } from '@main/common/utils/chat-ui.helper';
  import { useAppStore } from '@main/common/store/app.store';
  import { useContactsStore } from '@main/common/store/contacts.store';
  import { useUiIncomingStore } from '@main/common/store/ui.incoming.store';
  import { useChatStore } from '@main/common/store/chat.store';
  import type { ChatListItemUiView, OutgoingMessageStatus } from '~/index';
  import ChatAvatar from '@main/common/components/chat/chat-avatar.vue';
  import ChatMessageStatus from '@main/common/components/messages/chat-message/chat-message-status.vue';

  const vUi3nHtml = Ui3nHtml;

  const props = defineProps<{
    data: ChatListItemUiView;
  }>();
  const emit = defineEmits(['click']);

  const { t } = useI18n();
  const { user: ownAddr } = storeToRefs(useAppStore());
  const { currentChatId } = storeToRefs(useChatStore());
  const { isBlacklisted } = useContactsStore();
  const { toggleRinging, joinIncomingCall, dismissIncomingCall, endCall, rejoinCall } = useUiIncomingStore();

  const selectedChatId = computed<string>(() => (currentChatId.value ? currentChatId.value.chatId : ''));

  const isGroupChat = computed<boolean>(() => props.data.isGroupChat);
  const currentChatObjId = computed(() => ({ isGroupChat: isGroupChat.value, chatId: props.data.chatId }));
  const isIncomingCall = computed(
    () => props.data.incomingCall && props.data.incomingCall.chatId && props.data.incomingCall.peerAddress,
  );
  const chatWithCall = computed(() => !!props.data.callStart);
  const isCallActive = computed(() => !!props.data.isCallActive);

  const nameHint = computed<string>(() => getChatNameHint(t, props.data));

  // Same mark as the one on the avatar in the chat header: a padlock for a
  // one-to-one chat with a blocked peer, an information mark for a group that
  // merely has blocked members in it.
  const blockingIcon = computed(() =>
    blockingIconFor(chatBlockingStateOf(props.data, isBlacklisted, ownAddr.value)),
  );

  const isLastMsgIncoming = computed(() => {
    if (!props.data.lastMsg) { return true; }
    return props.data.lastMsg.isIncomingMsg;
  });
  const lastMsgStatus = computed(() => {
    if (isLastMsgIncoming.value || props.data.lastMsg?.chatMessageType !== 'regular') { return undefined; }

    return props.data.lastMsg?.status as OutgoingMessageStatus;
  });

  const message = computed<string>(() => {
    const lastMsg = props.data.lastMsg;
    if (!lastMsg) { return ' '; }

    switch (lastMsg.chatMessageType) {
      case 'regular': {
        const { attachments, isIncomingMsg, body } = lastMsg;
        // A recording is named by what it is, not by the generated file name it
        // was attached under.
        const recording = recordingOfAttachments(attachments);
        const attachmentsText = recording
          ? recordingExcerpt(recording, t)
          : attachments?.map(a => a.name).join(', ') || ' ';
        if (isIncomingMsg) {
          return body || `<i>${t('app.text.receive.file')}: ${attachmentsText}</i>`;
        }

        return `<b>${t('app.text.msg_sender.you')}: </b>${body || `<i>${t('app.text.send.file')}: ${attachmentsText}</i>`}`;
      }

      case 'system':
        return `<i>${getTextForChatSystemMessage(t, lastMsg, props.data.isGroupChat, ownAddr.value)}</i>`;

      case 'invitation':
        return `<i>${getTextForChatInvitationMessage(t, lastMsg, props.data.status)}</i>`;

      default:
        return ' ';
    }
  });

  const date = computed<string>(() => {
    const chatLastDate = props.data.lastMsg?.timestamp ? props.data.lastMsg.timestamp : props.data.createdAt;

    return prepareDateAsSting(chatLastDate!);
  });

  const callInOnSince = computed(() => {
    if (chatWithCall.value) {
      return dayjs(props.data.callStart).format('HH:mm');
    }

    return '';
  });

  watch(isIncomingCall, async val => {
    await toggleRinging(!!val);
  });
</script>

<template>
  <div
    :class="[$style.chatListItem, data.chatId === selectedChatId && $style.chatListItemSelected]"
    @click="emit('click', $event)"
  >
    <div :class="$style.chatListItemAvatar">
      <chat-avatar
        :name="data.displayName"
        :shape="isGroupChat ? 'decagon' : 'circle'"
        :call-in-progress="chatWithCall"
        :settings="data.settings"
      />

      <ui3n-icon
        v-if="blockingIcon"
        :icon="blockingIcon"
        color="var(--warning-content-default)"
        :class="$style.banned"
      />
    </div>

    <div :class="$style.chatListItemBody">
      <div :class="$style.chatListItemContent">
        <div
          :class="[
            $style.chatListItemName,
            (chatWithCall || isIncomingCall || isCallActive) && $style.callInProgress,
          ]"
        >
          <ui3n-icon
            v-if="chatWithCall || isIncomingCall || isCallActive"
            icon="round-phone-in-talk"
            :width="16"
            :height="16"
            color="var(--color-icon-block-accent-default)"
          />

          <span>{{ data.displayName }}</span>

          <span
            v-if="nameHint"
            :class="$style.chatListItemNameHint"
            :title="nameHint"
          >
            {{ nameHint }}
          </span>
        </div>

        <div
          v-if="chatWithCall || isIncomingCall || isCallActive"
          :class="$style.chatListItemMessage"
        >
          <i v-if="chatWithCall">{{ t('va.text.call_in_progress') }} {{ callInOnSince }}</i>
          <i v-else-if="isIncomingCall">{{
            t('va.presettings.incoming_call', { address: data.incomingCall!.peerAddress })
          }}</i>
          <i v-else>{{ t('va.text.call_is_active') }}</i>
        </div>

        <div
          v-else
          v-ui3n-html:sanitize="message"
          :class="$style.chatListItemMessage"
        />
      </div>

      <div :class="$style.chatListItemInfo">
        <div :class="$style.chatListItemDate">
          {{ date }}
        </div>

        <div :class="$style.chatListItemStatus">
          <ui3n-button
            v-if="chatWithCall"
            type="custom"
            size="small"
            color="var(--error-content-default)"
            text-color="var(--white-100)"
            icon="round-phone-disabled"
            icon-color="var(--error-fill-default)"
            icon-position="left"
            @click.stop.prevent="() => endCall(currentChatObjId)"
          >
            {{ t('va.btn.end_call') }}
          </ui3n-button>

          <template v-else-if="isIncomingCall">
            <ui3n-button
              type="custom"
              size="small"
              color="var(--success-content-default)"
              text-color="var(--success-fill-default)"
              icon="round-phone"
              icon-color="var(--success-fill-default)"
              icon-position="left"
              @click.stop.prevent="() => joinIncomingCall(currentChatObjId, data.incomingCall!.peerAddress)"
            >
              {{ t('va.presettings.btn.join') }}
            </ui3n-button>

            <ui3n-button
              type="custom"
              size="small"
              color="var(--warning-content-default)"
              text-color="var(--warning-fill-default)"
              icon="round-call-end"
              icon-color="var(--warning-fill-default)"
              icon-position="left"
              @click.stop.prevent="() => dismissIncomingCall(currentChatObjId, false)"
            >
              {{ t('va.presettings.btn.decline') }}
            </ui3n-button>
          </template>

          <ui3n-button
            v-else-if="isCallActive"
            type="custom"
            size="small"
            color="var(--success-content-default)"
            text-color="var(--success-fill-default)"
            icon="round-phone"
            icon-color="var(--success-fill-default)"
            icon-position="left"
            @click.stop.prevent="() => rejoinCall(currentChatObjId)"
          >
            {{ t('va.btn.rejoin_call') }}
          </ui3n-button>

          <template v-else>
            <ui3n-badge
              v-if="isLastMsgIncoming && data.unread"
              :value="data.unread"
              :class="$style.badge"
            />

            <chat-message-status
              v-if="!isLastMsgIncoming && lastMsgStatus"
              :value="lastMsgStatus"
              icon-size="12"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@main/common/assets/styles/mixins' as mixins;

  .chatListItem {
    --chat-list-item-height: 64px;

    position: relative;
    width: 100%;
    height: var(--chat-list-item-height);
    padding: 0 var(--spacing-m);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    border-radius: var(--spacing-xs);

    &:hover {
      cursor: pointer;
      background-color: var(--color-bg-chat-bubble-general-bg);
    }

    &.chatListItemSelected {
      background-color: var(--color-bg-chat-bubble-general-bg);
    }
  }

  .chatListItemAvatar {
    position: relative;
    width: fit-content;
    flex-shrink: 0;

    .banned {
      position: absolute;
      top: -4px;
      right: -4px;
      z-index: 1;
    }
  }

  .chatListItemBody {
    position: relative;
    width: calc(100% - 36px);
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-left: var(--spacing-s);
    overflow: hidden;
  }

  .chatListItemContent {
    position: relative;
    flex-grow: 1;
    overflow: hidden;
  }

  .chatListItemName {
    position: relative;
    height: 22px;
    width: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-xs);

    span {
      display: block;
      font-size: var(--font-16);
      font-weight: 500;
      line-height: 22px;
      color: var(--color-text-chat-bubble-other-default);
      @include mixins.text-overflow-ellipsis();
    }

    &.callInProgress {
      span {
        @include mixins.text-overflow-ellipsis(calc(100% - 20px));
      }
    }

    span.chatListItemNameHint {
      flex-shrink: 0;
      font-size: var(--font-12);
      font-weight: 400;
      color: var(--color-text-chat-bubble-other-sub);
      @include mixins.text-overflow-ellipsis(45%);
    }
  }

  .chatListItemMessage {
    position: relative;
    height: var(--spacing-ml);
    font-size: var(--font-14);
    font-weight: 400;
    line-height: var(--spacing-ml);
    color: var(--color-text-chat-bubble-other-default);
    @include mixins.text-overflow-ellipsis();
  }

  .chatListItemInfo {
    position: relative;
    width: max-content;
    padding: 0 var(--spacing-xs);
  }

  .chatListItemDate {
    position: relative;
    height: 22px;
    white-space: nowrap;
    text-align: right;
    margin-bottom: 2px;
    font-size: var(--font-10);
    font-weight: 400;
    line-height: 22px;
    color: var(--color-text-chat-bubble-other-sub);
  }

  .chatListItemStatus {
    position: relative;
    height: var(--spacing-ml);
    display: flex;
    justify-content: flex-end;
    align-items: center;
    column-gap: var(--spacing-xs);

    .badge {
      min-width: 20px !important;
    }
  }
</style>
