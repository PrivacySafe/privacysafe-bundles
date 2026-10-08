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
  import { onBeforeMount, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import size from 'lodash/size';
  import { Ui3nButton, Ui3nIcon, Ui3nMenu, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { useAppStore, useContactsStore } from '@common/store';
  import { SYSTEM_FOLDERS } from '@common/constants';
  import type { IncomingMessageView, MessageAction, OutgoingMessageView } from '@common/types';
  import MessageContentHeader from './message-content-header.vue';
  import MessageContentHeaderOutbox from './message-content-header-outbox.vue';
  import MessageContentHeaderDraft from './message-content-header-draft.vue';
  import MessageContentSubject from './message-content-subject.vue';
  import MessageContentFrom from './message-content-from.vue';
  import MessageContentTo from './message-content-to.vue';
  import MessageContentAttachments from './message-content-attachments.vue';
  import TextEditor from '@common/components/text-editor/text-editor.vue';

  const props = defineProps<{
    message?: IncomingMessageView | OutgoingMessageView;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { action: MessageAction; message: IncomingMessageView | OutgoingMessageView }): void;
  }>();

  const { t } = useI18n();
  const { isMobileMode } = storeToRefs(useAppStore());
  const contactsStore = useContactsStore();
  const { getContactList } = contactsStore;
  const { contactList } = storeToRefs(contactsStore);

  onBeforeMount(async () => {
    await getContactList();
  });

  watch(
    () => props.message?.msgId,
    async (val, oldVal) => {
      if (val && val !== oldVal) {
        const isMessageIncoming = !!(props.message as IncomingMessageView)?.sender;
        if (isMessageIncoming && props.message?.status !== 'read') {
          setTimeout(async () => {
            emits('action', { action: 'mark-as-read', message: props.message! });
          }, 400);
        }
      }
    },
    {
      immediate: true,
    },
  );
</script>

<template>
  <div
    v-if="message"
    :class="$style.messageContent"
  >
    <div
      v-if="!isMobileMode"
      :class="$style.header"
    >
      <message-content-header-outbox
        v-if="message?.mailFolder === SYSTEM_FOLDERS.outbox"
        :message="message as OutgoingMessageView"
        @action="emits('action', $event)"
      />

      <message-content-header-draft
        v-else-if="message?.mailFolder === SYSTEM_FOLDERS.draft"
        :message="message as OutgoingMessageView"
        @action="emits('action', $event)"
      />

      <message-content-header
        v-else
        :message="message"
        @action="emits('action', $event)"
      />

      <div :class="$style.headerAction">
        <ui3n-menu
          position-strategy="fixed"
          :offset-y="4"
          :content-border-radius="8"
        >
          <ui3n-tooltip
            :content="t('msg.content.tooltip.delete')"
            placement="top-end"
            position-strategy="fixed"
          >
            <ui3n-button
              type="icon"
              icon="outline-delete"
              icon-color="var(--error-content-default)"
              color="var(--color-bg-block-primary-default)"
            />
          </ui3n-tooltip>

          <template #menu>
            <div :class="$style.menu">
              <div
                :class="[$style.menuItem, message.mailFolder === SYSTEM_FOLDERS.trash && $style.menuItemDisabled]"
                @click="emits('action', { action: 'move-to-trash', message })"
              >
                <ui3n-icon icon="trash-can" />
                <span>{{ t('msg.content.btn.moveToTrash') }}</span>
              </div>

              <div
                :class="[$style.menuItem, $style.accent]"
                @click="emits('action', { action: 'delete', message })"
              >
                <ui3n-icon
                  icon="outline-delete"
                  color="var(--warning-content-default)"
                />

                <span>{{ t('msg.content.btn.deleteForever') }}</span>
              </div>
            </div>
          </template>
        </ui3n-menu>
      </div>
    </div>

    <message-content-subject :message="message" />

    <div :class="$style.contacts">
      <message-content-from
        :message="message"
        :contact-list="contactList"
      />

      <message-content-to
        :message="message"
        :contact-list="contactList"
      />
    </div>

    <div
      v-if="size(message.attachmentsInfo)"
      :class="$style.attachments"
    >
      <message-content-attachments
        :message="message"
        :readonly="message?.mailFolder === SYSTEM_FOLDERS.outbox"
      />
    </div>

    <div :class="$style.messageBody">
      <text-editor
        v-if="message.htmlTxtBody"
        :text="message.htmlTxtBody"
        disabled
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  @use '@common/assets/styles/_mixins' as mixins;

  .messageContent {
    position: relative;
    width: 100%;
    background-color: var(--color-bg-block-primary-default);
    border-radius: 12px;
  }

  .header {
    position: relative;
    width: 100%;
    height: var(--spacing-xl);
    padding-right: var(--spacing-xxl);
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }

  .headerAction {
    position: absolute;
    width: var(--spacing-l);
    height: var(--spacing-l);
    top: var(--spacing-xs);
    right: var(--spacing-m);
  }

  .menu {
    position: relative;
    background-color: var(--color-bg-control-secondary-default);
    width: fit-content;
    border-radius: var(--spacing-xs);

    @include mixins.elevation(1);
  }

  .menuItem {
    position: relative;
    width: max-content;
    height: var(--spacing-l);
    padding: 0 calc(var(--spacing-s) * 1.5) 0 var(--spacing-s);
    font-size: var(--font-13);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    cursor: pointer;

    &.accent {
      color: var(--warning-content-default);
    }

    &.menuItemDisabled {
      cursor: default;
      pointer-events: none;
      opacity: 0.25;
    }

    &:hover {
      background-color: var(--color-bg-control-primary-hover);
      color: var(--color-text-control-accent-default);

      & > div {
        color: var(--color-text-control-accent-default) !important;
      }
    }
  }

  .contacts {
    position: relative;
    width: 100%;
    padding: 12px var(--spacing-m);
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    row-gap: var(--spacing-s);
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }

  .attachments {
    position: relative;
    width: 100%;
    padding: var(--spacing-s) var(--spacing-m);
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }

  .messageBody {
    position: relative;
    width: 100%;
    padding: var(--spacing-s);
    //border-bottom: 1px solid var(--color-border-block-primary-default);
  }
</style>
