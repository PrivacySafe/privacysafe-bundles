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
  import get from 'lodash/get';
  import { Ui3nIcon, Ui3nMenu, Ui3nTooltip } from '@v1nt1248/3nclient-lib';
  import { useAppStore, useContactsStore } from '@common/store';
  import { useContactInMessage } from '@common/composables/useContactInMessage';
  import { ContactListItem, IncomingMessageView, OutgoingMessageView } from '@common/types';
  import AddressChip from '@common/components/address-chip/address-chip.vue';

  const props = defineProps<{
    message: IncomingMessageView | OutgoingMessageView;
    contactList: ContactListItem[];
  }>();

  const { t } = useI18n();
  const { user } = storeToRefs(useAppStore());
  const { isBlacklisted } = useContactsStore();

  const { addressMenuData, openAddressMenu, addNewContact } = useContactInMessage();

  const isIncomingMessage = computed(() => !!(props.message as IncomingMessageView).sender);

  const senderAddress = computed(() =>
    isIncomingMessage.value ? (props.message as IncomingMessageView).sender : user.value,
  );

  const sender = computed(() => {
    if (!isIncomingMessage.value) {
      return 'Me';
    }

    const value = get(props.message, 'sender', '');

    if (!value.includes('@')) {
      return value;
    }

    const contact = props.contactList.find(c => c.mail === value);
    return contact?.name || contact?.mail || (props.message as IncomingMessageView).sender;
  });

  const isSenderBlocked = computed(() =>
    isIncomingMessage.value && !!senderAddress.value && isBlacklisted(senderAddress.value));

  // Nothing to add: blocking has made the contact already, and offering it here
  // would read as though the blocking had not taken.
  const allowAddingContact = computed(() =>
    !isSenderBlocked.value && !props.contactList.find(c => c.mail === senderAddress.value));
</script>

<template>
  <div :class="$style.msgFrom">
    <div :class="$style.label">
      {{ t('msg.create.label.from') }}:
    </div>

    <address-chip
      :address="sender"
      :tooltip-content="senderAddress"
      :allow-adding="allowAddingContact"
      @select="() => openAddressMenu(senderAddress)"
    />

    <ui3n-tooltip
      v-if="isSenderBlocked"
      :content="t('msg.content.blocked_sender')"
      position-strategy="fixed"
      placement="top-start"
    >
      <ui3n-icon
        icon="round-lock"
        :width="16"
        :height="16"
        color="var(--warning-content-default)"
      />
    </ui3n-tooltip>

    <ui3n-menu
      v-model="addressMenuData.isOpen"
      position-strategy="fixed"
      :offset-y="2"
      :trigger-element="addressMenuData.triggerElement!"
    >
      <template #menu>
        <div
          :class="$style.menuItem"
          @click.stop.prevent="addNewContact"
        >
          <ui3n-icon
            icon="outline-person-add"
            width="16"
            height="16"
            color="var(color-icon-control-primary-default)"
          />

          <span>{{ t('msg.content.add_address') }}</span>
        </div>
      </template>
    </ui3n-menu>
  </div>
</template>

<style lang="scss" module>
  .msgFrom {
    position: relative;
    width: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-xs);
  }

  .label {
    font-size: var(--font-14);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
  }

  .menuItem {
    position: relative;
    width: max-content;
    height: var(--spacing-l);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    padding: 0 var(--spacing-s);
    background-color: var(--color-bg-control-secondary-default);
    font-size: var(--font-13);
    font-weight: 400;
    color: var(--color-text-control-primary-default);
    cursor: pointer;

    &:hover {
      background-color: var(--color-bg-control-secondary-hover);
    }
  }
</style>
