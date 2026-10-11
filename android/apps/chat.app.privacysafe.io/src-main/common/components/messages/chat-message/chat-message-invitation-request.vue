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
  import { computed, inject, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import get from 'lodash/get';
  import { Ui3nButton, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { prepareDateAsSting } from '@v1nt1248/3nclient-lib/utils';
  import { getTextForChatInvitationMessage } from '@main/common/utils/chat-ui.helper';
  import { areChatIdsEqual } from '@shared/chat-ids';
  import { useRouting } from '@main/desktop/composables/useRouting';
  import { useAppStore } from '@main/common/store/app.store';
  import { useContactsStore } from '@main/common/store/contacts.store';
  import { useChatStore } from '@main/common/store/chat.store';
  import { useChatsStore } from '@main/common/store/chats.store';
  import type { ChatInvitationMsgView } from '~/chat.types';

  const props = defineProps<{
    msg: ChatInvitationMsgView;
  }>();

  const { t } = useI18n();
  const notification = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const { router } = useRouting();

  const isAddingContact = ref(false);

  const { user, isMobileMode } = storeToRefs(useAppStore());

  const contactsStore = useContactsStore();
  const { contactList } = storeToRefs(contactsStore);
  const { addContact, fetchContacts } = contactsStore;

  const { acceptChatInvitation, refreshChatList } = useChatsStore();

  const chatStore = useChatStore();
  const { deleteChat, resetCurrentChat } = chatStore;
  const { currentChat, currentChatId } = storeToRefs(chatStore);

  const date = computed(() => {
    const { timestamp } = props.msg;
    return prepareDateAsSting(timestamp);
  });

  const isChatAccepted = computed(
    () =>
      (currentChat.value?.isGroupChat && get(currentChat.value, ['members', user.value, 'hasAccepted'])) ||
      (!currentChat.value?.isGroupChat && currentChat.value?.status === 'on'),
  );

  const doesAllowAddingContact = computed(() => !contactList.value.find(c => c.mail === props.msg.sender));
  const tooltipText = computed(() =>
    doesAllowAddingContact.value
      ? t('chat.invitation.tooltip.oto.incoming_from_unknown', { address: props.msg.sender })
      : '',
  );

  async function deny() {
    await deleteChat(props.msg.chatId, false);
    if (areChatIdsEqual(currentChatId.value, props.msg.chatId)) {
      resetCurrentChat();
      await router.push({ name: 'chats' });
    }
    await refreshChatList();
  }

  async function accept() {
    await acceptChatInvitation({
      chatId: currentChatId.value!,
      chatMessageId: props.msg.chatMessageId,
    });
    await refreshChatList();
  }

  async function addContactToList() {
    if (isAddingContact.value) {
      return;
    }
    isAddingContact.value = true;
    try {
      await addContact(props.msg.sender);
      await fetchContacts();
    } catch (err) {
      // Invoked from a template click, so a rejection here used to end up as
      // an Uncaught (in promise) with nothing shown to the user.
      console.error(`Failed to add contact ${props.msg.sender}:`, err);
      notification.$createNotice({
        type: 'error',
        content: t('chat.contact.add.error.unknown', { addr: props.msg.sender }),
      });
    } finally {
      isAddingContact.value = false;
    }
  }
</script>

<template>
  <div
    :class="[
      $style.chatMessageInvitationRequest,
      isMobileMode && $style.chatMessageInvitationRequestMobile,
      doesAllowAddingContact && $style.clickable,
    ]"
    v-on="doesAllowAddingContact && !isAddingContact ? { click: addContactToList } : {}"
  >
    <ui3n-tooltip
      :content="tooltipText"
      position-strategy="fixed"
      :placement="isMobileMode ? 'top-start' : 'top'"
      :disabled="!tooltipText"
    >
      <div :class="$style.text">
        {{ getTextForChatInvitationMessage(t, msg) }}
      </div>
    </ui3n-tooltip>

    <div
      v-if="!isChatAccepted && currentChat?.status !== 'no-members' && currentChat?.status !== 'accepted'"
      :class="$style.action"
    >
      <ui3n-button
        type="custom"
        size="small"
        color="var(--warning-content-default)"
        text-color="var(--warning-fill-default)"
        @click.stop.prevent="deny"
      >
        {{ t('chat.invitation.btn.deny') }}
      </ui3n-button>

      <ui3n-button
        type="custom"
        size="small"
        color="var(--success-content-default)"
        text-color="var(--success-fill-default)"
        @click.stop.prevent="accept"
      >
        {{ t('chat.invitation.btn.accept') }}
      </ui3n-button>
    </div>

    <div :class="$style.date">
      {{ date }}
    </div>
  </div>
</template>

<style lang="scss" module>
  .chatMessageInvitationRequest {
    position: relative;
    width: fit-content;
    max-width: 90%;
    overflow: hidden;
    margin: var(--spacing-s) auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 12px;
    font-size: var(--font-12);
    font-weight: 500;
    user-select: none;
    color: var(--color-text-block-secondary-default);
    flex-direction: column;
    gap: var(--spacing-s);

    &.clickable {
      cursor: pointer;
    }

    &.chatMessageInvitationRequestMobile {
      height: auto;
      column-gap: 6px;
      padding: 6px var(--spacing-m);

      .text {
        white-space: break-spaces;
        text-align: center;
      }

      .date {
        min-width: fit-content;
      }
    }
  }

  .text {
    position: relative;
    min-width: 100px;
    color: var(--color-text-block-secondary-default);
    text-align: center;
    line-height: 1.4;
  }

  .date {
    min-width: fit-content;
    white-space: nowrap;
    position: relative;
    color: var(--color-text-chat-bubble-user-sub);
  }

  .action {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-xs);
  }
</style>
