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
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { prepareDateAsSting } from '@v1nt1248/3nclient-lib/utils';
import { Ui3nButton, Ui3nIcon } from '@v1nt1248/3nclient-lib';
import { getTextForChatInvitationMessage, getTextForChatSystemMessage } from '@main/common/utils/chat-ui.helper';
import { callCancelWording } from '@shared/call-record-wording';
import { areAddressesEqual } from '@shared/address-utils';
import { useAppStore } from '@main/common/store/app.store';
import { useContactBlocking } from '@main/common/composables/useContactBlocking';
import {
  CallMsgBodySysMsgData,
  ChatInvitationMsgView,
  ChatMessageView,
  ChatSysMsgView,
  ContactBlockedSysMsgData,
  WebRTCMsgBodySysMsgData,
} from '~/index';

const props = withDefaults(
  defineProps<{
    msg: ChatMessageView;
    /**
     * Who is blocked right now, as canonical addresses. Computed once for the
     * whole list (see useChatView) rather than asked of the store by every row.
     */
    blockedMembers?: string[];
  }>(),
  { blockedMembers: () => [] },
);

const { t } = useI18n();
const { isMobileMode, user: ownAddr } = storeToRefs(useAppStore());
const { runContactBlocking } = useContactBlocking();

const data = computed(() => {
  const { chatMessageType } = props.msg;
  return chatMessageType === 'system'
    ? (props.msg as ChatSysMsgView).systemData
    : (props.msg as ChatInvitationMsgView).inviteData;
});

const isSystemMsgByCall = computed(() => ['call', 'webrtc-call'].includes((data.value as ChatSysMsgView['systemData']).event));

const isContactBlockedMsg = computed(
  () => (data.value as ChatSysMsgView['systemData']).event === 'contact:blocked',
);

const isContactRelatedMsg = computed(() => isContactBlockedMsg.value || (data.value as ChatSysMsgView['systemData']).event === 'contact:unblocked');

/**
 * The address this record is about, or undefined when it is about something
 * else entirely.
 */
const blockedContactMail = computed(() => {
  const systemData = data.value as ChatSysMsgView['systemData'];
  return systemData.event === 'contact:blocked'
    ? (systemData as ContactBlockedSysMsgData).value.mail
    : undefined;
});

/**
 * The button is offered only while the block is still in force. A record of a
 * block that has since been lifted stays in the history as it was written.
 */
const canUnblockContact = computed(() => {
  const mail = blockedContactMail.value;
  return !!mail && props.blockedMembers.some(addr => areAddressesEqual(addr, mail));
});

function unblockContact() {
  return runContactBlocking(blockedContactMail.value!, false);
}
const isSystemMsgByMissedCall = computed(() => (data.value as ChatSysMsgView['systemData']).event === 'webrtc-call');
const isSystemMsgByIncomingCall = computed(() => {
  if (!isSystemMsgByCall.value) {
    return false;
  }
  const systemData = data.value as ChatSysMsgView['systemData'];
  if (systemData.event === 'webrtc-call') {
    // The same rule that picks the wording, so the arrow cannot contradict the
    // line next to it: the subtype alone says nothing about which way the call
    // went - a decline is written the same way on both sides of it.
    const { subType, callSessionId } = (systemData as WebRTCMsgBodySysMsgData).value;
    return callCancelWording(
      subType, callSessionId, ownAddr.value, props.msg.chatId.isGroupChat,
    ).wasIncomingCall;
  }
  return (systemData as CallMsgBodySysMsgData).value.direction === 'incoming';
});
const callDuration = computed(() => {
  if (!isSystemMsgByCall.value) {
    return null;
  }

  const { endTimestamp } = ((data.value as ChatSysMsgView['systemData']) as CallMsgBodySysMsgData).value;
  if (typeof endTimestamp !== 'number') {
    return null;
  }

  const duration = props.msg.timestamp > endTimestamp ? 0 : endTimestamp - props.msg.timestamp;
  const durationInSeconds = Math.floor(duration / 1000);

  if (durationInSeconds < 60) {
    return `${String(durationInSeconds).padStart(2, '0')} s`;
  }

  const durationInMinutes = Math.floor(durationInSeconds / 60);
  const h = Math.floor(durationInMinutes / 60);
  const m = durationInMinutes % 60;

  if (h === 0) {
    return `${m}m`;
  }

  return `${h}H ${String(m).padStart(2, '0')}m`;
});

const msgText = computed(() => {
  const { chatMessageType } = props.msg;
  switch (chatMessageType) {
    case 'invitation':
      return getTextForChatInvitationMessage(t, props.msg);
    case 'system': {
      const text = getTextForChatSystemMessage(t, props.msg, props.msg.chatId.isGroupChat, ownAddr.value);
      return isSystemMsgByCall.value && callDuration.value ? `${text} (${callDuration.value})` : text;
    }
    default:
      return props.msg.body;
  }
});

const date = computed(() => {
  const { timestamp } = props.msg;
  return prepareDateAsSting(timestamp);
});
</script>

<template>
  <div
    :class="[
      $style.chatMessageSystem,
      isMobileMode && $style.chatMessageSystemMobile,
      isSystemMsgByCall && $style.byCall,
      isSystemMsgByMissedCall && $style.warning,
      isContactRelatedMsg && $style.contactRelatedMsg,
    ]"
  >
    <ui3n-icon
      v-if="isSystemMsgByCall"
      :icon="isSystemMsgByIncomingCall ? 'round-call-received' : 'round-call-made'"
      :color="isSystemMsgByIncomingCall ? 'var(--success-content-default)' : 'var(--error-content-default)'"
      :width="16"
      :height="16"
      :class="$style.icon"
    />

    <ui3n-icon
      v-if="isContactBlockedMsg"
      icon="outline-account-off-circle"
      color="var(--warning-content-default)"
      :width="16"
      :height="16"
      :class="$style.icon"
    />

    <div :class="$style.text">
      <span>{{ msgText }}</span>
    </div>

    <div
      v-if="canUnblockContact"
      :class="$style.unblockBtnBox"
    >
      <ui3n-button
        type="custom"
        :size="isMobileMode ? 'large' : 'small'"
        color="var(--success-content-default)"
        text-color="var(--success-fill-default)"
        @click="unblockContact"
      >
        {{ t('dialog.button.unblock') }}
      </ui3n-button>
    </div>

    <div :class="$style.date">
      {{ date }}
    </div>
  </div>
</template>

<style lang="scss" module>
@use '@main/common/assets/styles/mixins' as mixins;

.chatMessageSystem {
  position: relative;
  width: fit-content;
  max-width: 90%;
  overflow: hidden;
  height: auto;
  margin: var(--spacing-s) auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  column-gap: var(--spacing-s);
  padding: 0 12px;
  font-size: var(--font-12);
  font-weight: 500;
  line-height: var(--font-16);
  user-select: none;

  &.chatMessageSystemMobile {
    padding: var(--spacing-s) var(--spacing-m);
  }

  &.byCall {
    .text {
      span {
        color: var(--color-text-block-primary-default)
      }
    }

    &.warning {
      .text {
        span {
          color: var(--color-text-block-warning-default);
        }
      }
    }
  }

  &.contactRelatedMsg {
    padding: 8px 12px;
    border-radius: 20px;
    background-color: var(--color-bg-chat-bubble-user-default);

    &.chatMessageSystemMobile {
      flex-direction: column;
      align-items: center;
      row-gap: var(--spacing-xs);

      .date {
        flex-grow: 0;
      }

      .unblockBtnBox {
        order: 1;
      }
    }
  }
}

.text {
  text-align: center;

  span {
    white-space: break-spaces;
    color: var(--color-text-block-secondary-default);
  }
}

.unblockBtnBox {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.date {
  flex-grow: 1;
  min-width: fit-content;
  color: var(--color-text-chat-bubble-user-sub);
}
</style>
