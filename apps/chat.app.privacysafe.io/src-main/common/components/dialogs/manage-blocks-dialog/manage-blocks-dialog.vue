<!--
 Copyright (C) 2026 3NSoft Inc.

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
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { Ui3nButton, Ui3nDialog, type Ui3nDialogEvent, Ui3nIcon, Ui3nInput } from '@v1nt1248/3nclient-lib';
  import { capitalize } from '@v1nt1248/3nclient-lib/utils';
  import { toCanonicalAddress } from '@shared/address-utils';
  import { useAppStore } from '@main/common/store/app.store';
  import { useContactsStore } from '@main/common/store/contacts.store';
  import { useContactBlocking } from '@main/common/composables/useContactBlocking';
  import type { GroupChatView, PersonView } from '~/index';
  import type { ManageBlocksDialogProps } from './types';
  import ContactListItem from '@main/common/components/contacts/contact-list-item.vue';

  const props = defineProps<ManageBlocksDialogProps>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent }): void;
  }>();

  const { t } = useI18n();
  const { user: ownAddr } = storeToRefs(useAppStore());
  const { isBlacklisted, getContactName } = useContactsStore();
  const { runContactBlocking } = useContactBlocking();

  const search = ref('');

  const dialogWidth = computed(() => (props.isMobileMode ? '300px' : '380px'));

  /**
   * Members are taken from the chat rather than from the address book: somebody
   * one has never added is still a member here, and still blockable.
   */
  const members = computed<(PersonView & { displayName: string })[]>(() => {
    if (!props.chat.isGroupChat) {
      return [];
    }

    const ownCAddr = ownAddr.value ? toCanonicalAddress(ownAddr.value) : undefined;
    return Object.keys((props.chat as GroupChatView).members ?? {})
      .map(addr => toCanonicalAddress(addr))
      .filter(addr => addr !== ownCAddr)
      .map(addr => ({ id: addr, mail: addr, displayName: getContactName(addr) }));
  });

  const filteredMembers = computed(() => {
    const query = search.value.trim().toLowerCase();
    return query
      ? members.value.filter(
          m => m.displayName.toLowerCase().includes(query) || m.mail.toLowerCase().includes(query),
        )
      : members.value;
  });

  function closeDialog() {
    emits('action', { event: 'close' });
  }
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :class="$style.manageBlocksDialog"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.body">
        <ui3n-input
          v-model="search"
          clearable
          :class="$style.search"
          :placeholder="t('chat.dialog.info.search_placeholder')"
        >
          <template #prepend-icon>
            <ui3n-icon icon="round-search" />
          </template>
        </ui3n-input>

        <!--
          Rows are rendered here rather than through contact-list: that one
          offers to add a contact when nothing matches the search, which is not
          what this dialog is for.
        -->
        <div :class="$style.memberList">
          <contact-list-item
            v-for="member in filteredMembers"
            :key="member.id"
            :contact="member"
            :selected="false"
            :without-anchor="true"
            :readonly="true"
          >
            <template #extra="{ mail }">
              <ui3n-button
                type="custom"
                size="small"
                :color="
                  isBlacklisted(mail) ? 'var(--success-content-default)' : 'var(--warning-content-default)'
                "
                :text-color="isBlacklisted(mail) ? 'var(--success-fill-default)' : 'var(--warning-fill-default)'"
                :class="$style.btn"
                @click.stop.prevent="runContactBlocking(mail, !isBlacklisted(mail))"
              >
                {{ isBlacklisted(mail) ? t('dialog.button.unblock') : t('dialog.button.block') }}
              </ui3n-button>
            </template>
          </contact-list-item>

          <div
            v-if="filteredMembers.length === 0"
            :class="$style.empty"
          >
            {{ t('chat.dialog.manage_blocks.nobody') }}
          </div>
        </div>
      </div>
    </template>

    <template #actions>
      <div :class="$style.actions">
        <span />

        <ui3n-button
          type="secondary"
          @click="closeDialog"
        >
          {{ capitalize(t('chat.dialog.info.btn.close')) }}
        </ui3n-button>
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .manageBlocksDialog {
    --manage-blocks-dialog-actions-height: 64px;

    position: relative;
    width: v-bind(dialogWidth);
    height: calc(var(--column-size) * 5);
    background-color: var(--color-bg-block-primary-default);
    border-radius: var(--spacing-m);
  }

  /* Only .memberList scrolls; see the note in chat-info-dialog.vue. */
  .body {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .search {
    width: calc(100% - var(--spacing-l));
    flex-shrink: 0;
    margin: var(--spacing-m) auto;
  }

  .memberList {
    position: relative;
    width: 100%;
    padding: 0 var(--spacing-m);
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;

    .btn {
      min-width: 64px;
    }
  }

  .empty {
    padding: var(--spacing-m) 0;
    text-align: center;
    font-size: var(--font-12);
    color: var(--color-text-control-secondary-default);
  }

  .actions {
    position: relative;
    width: 100%;
    height: var(--manage-blocks-dialog-actions-height);
    padding: 0 var(--spacing-m);
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid var(--color-border-block-primary-default);

    button {
      text-transform: capitalize;
    }
  }
</style>
