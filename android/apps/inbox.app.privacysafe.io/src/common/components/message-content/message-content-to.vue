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
  import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import size from 'lodash/size';
  import { VUEBUS_KEY, VueBusPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { type Nullable, Ui3nButton, Ui3nIcon, Ui3nMenu } from '@v1nt1248/3nclient-lib';
  import { useContactInMessage } from '@common/composables/useContactInMessage';
  import type { AppGlobalEvents, ContactListItem, IncomingMessageView, OutgoingMessageView } from '@common/types';

  import AddressChip from '@common/components/address-chip/address-chip.vue';

  const props = defineProps<{
    message: IncomingMessageView | OutgoingMessageView;
    contactList: ContactListItem[];
  }>();

  const $bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const { t } = useI18n();

  const wrapperEl = ref<Nullable<HTMLDivElement>>(null);
  const bodyEl = ref<Nullable<HTMLDivElement>>(null);
  const isBlockOpen = ref(false);
  const isOverflowing = ref(true);
  const firstRowContactCount = ref(0);

  const { addressMenuData, openAddressMenu, addNewContact } = useContactInMessage();

  function initRecipientListDisplaying() {
    isBlockOpen.value = false;
    isOverflowing.value = true;
    firstRowContactCount.value = 0;

    setTimeout(() => {
      if (wrapperEl.value && bodyEl.value && !isBlockOpen.value) {
        isOverflowing.value = bodyEl.value.clientHeight > wrapperEl.value.clientHeight;

        if (isOverflowing.value) {
          if (isBlockOpen.value || !bodyEl.value || size(bodyEl.value?.children) === 0) {
            firstRowContactCount.value = 0;
          } else {
            const bodyElWidth = bodyEl.value.clientWidth;
            let startWidth = 0;

            firstRowContactCount.value = [...bodyEl.value.children].reduce((acc, el) => {
              startWidth += (el.clientWidth + 4);
              if (startWidth < bodyElWidth) {
                acc += 1;
              }

              return acc;
            }, 0);
          }
        }
      }
    }, 250);
  }

  function getContactDisplayName(mail: string): string {
    const contact = props.contactList.find(c => c.mail === mail);
    return contact ? contact.displayName : mail;
  }

  function doesAllowAddingContact(mail: string): boolean {
    return !props.contactList.find(c => c.mail === mail);
  }

  function extendRecipientsBlock() {
    isBlockOpen.value = true;
  }

  onMounted(() => {
    $bus.$emitter.on('resize-app', initRecipientListDisplaying);
  });

  onBeforeUnmount(() => {
    $bus.$emitter.off('resize-app', initRecipientListDisplaying);
  });

  watch(
    () => props.message.msgId,
    (val, oldVal) => {
      if (val !== oldVal) {
        initRecipientListDisplaying();
      }
    }, {
      immediate: true,
    }
  );
</script>

<template>
  <div :class="$style.msgTo">
    <div :class="$style.label">
      {{ t('msg.create.label.to') }}:
    </div>

    <div
      ref="wrapperEl"
      :class="[
        $style.recipients,
        isBlockOpen && $style.opened,
        isOverflowing && $style.overflowing
      ]"
    >
      <div
        ref="bodyEl"
        :class="$style.body"
      >
        <template
          v-for="address in message.recipients"
          :key="address"
        >
          <address-chip
            :address="getContactDisplayName(address)"
            :tooltip-content="address"
            :allow-adding="doesAllowAddingContact(address)"
            @select="() => openAddressMenu(address)"
          />
        </template>

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

      <ui3n-button
        v-if="isOverflowing && !isBlockOpen && firstRowContactCount !== 0"
        type="secondary"
        :class="$style.btn"
        @click.stop.prevent="extendRecipientsBlock"
      >
        +{{ size(contactList) - firstRowContactCount }}
      </ui3n-button>
    </div>
  </div>
</template>

<style lang="scss" module>
  .msgTo {
    position: relative;
    width: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: flex-start;
    column-gap: var(--spacing-xs);
  }

  .label {
    padding-top: var(--spacing-s);
    font-size: var(--font-14);
    font-weight: 600;
    color: var(--color-text-control-primary-default);
  }

  .recipients {
    position: relative;
    flex-grow: 1;
    height: var(--spacing-l);
    overflow: hidden;

    &.opened {
      height: auto;
    }

    &.overflowing {
      padding-right: var(--spacing-xxl);
    }
  }

  .body {
    display: flex;
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
    align-items: flex-start;
    gap: var(--spacing-xs);
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

  .btn {
    position: absolute !important;
    top: 0;
    right: 0;
    padding: var(--spacing-s) !important;
  }
</style>
