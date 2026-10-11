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
  import { Ui3nButton, Ui3nDialog, Ui3nIcon, Ui3nInput } from '@v1nt1248/3nclient-lib';
  import { useAppStore, useContactsStore, useMessagesStore } from '@common/store';
  import { useContactBlocking } from '@common/composables/useContactBlocking';
  import { collectUsedAddresses } from '@common/utils';
  import { canonicalAddressOrUndefined } from '@shared/utils/address-utils';
  import type { BlockableRow, ManageBlocksDialogProps, ManageBlocksDialogEmits } from './types';
  import ContactIcon from '@common/components/contact-icon/contact-icon.vue';

  const props = defineProps<ManageBlocksDialogProps>();
  const emits = defineEmits<ManageBlocksDialogEmits>();

  const { t } = useI18n();
  const { user } = storeToRefs(useAppStore());
  const { contactList } = storeToRefs(useContactsStore());
  const { messageList } = storeToRefs(useMessagesStore());
  const { isBlacklisted } = useContactsStore();
  const { runContactBlocking } = useContactBlocking();

  const search = ref('');

  const dialogWidth = computed(() => (props.isMobileMode ? '300px' : '380px'));

  const ownCanonicalAddr = computed(() => canonicalAddressOrUndefined(user.value));

  /** Whether this address is the user's own, whatever the spelling. */
  function isOwnAddress(mail: string): boolean {
    const canonical = canonicalAddressOrUndefined(mail);
    return !!canonical && canonical === ownCanonicalAddr.value;
  }

  const contactRows = computed<BlockableRow[]>(() =>
    contactList.value
      // The user can have themselves in their own address book, and blocking
      // yourself is not something this dialog has any business offering: the
      // incoming filter excludes the own address on purpose, so the row would
      // promise something that never happens.
      .filter(contact => !isOwnAddress(contact.mail))
      .map(contact => ({
        id: contact.id,
        mail: contact.mail,
        displayName: contact.displayName || contact.mail,
        isContact: true,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );

  /**
   * Addresses met in the mailbox but never added to the address book.
   *
   * Blocking is not a privilege of the address book: most of what one wants to
   * block has never been added to it, and adding somebody in order to block them
   * is exactly the step worth sparing the user. The contact itself is still made
   * - see setContactBlocking - just not by hand.
   */
  const usedRows = computed<BlockableRow[]>(() => {
    const known = new Set(
      contactList.value
        .map(contact => canonicalAddressOrUndefined(contact.mail))
        .filter((addr): addr is string => !!addr),
    );
    return collectUsedAddresses(Object.values(messageList.value), user.value)
      .filter(mail => {
        const canonical = canonicalAddressOrUndefined(mail);
        // The own address is left out by collectUsedAddresses as well; asked
        // again here so that one rule covers both groups even when the user's
        // address has not loaded yet and that call had nothing to compare to.
        return !!canonical && !known.has(canonical) && !isOwnAddress(mail);
      })
      .sort((a, b) => a.localeCompare(b))
      .map(mail => ({ id: mail, mail, displayName: mail, isContact: false }));
  });

  function matchesSearch(row: BlockableRow, query: string): boolean {
    return row.displayName.toLowerCase().includes(query) || row.mail.toLowerCase().includes(query);
  }

  const filteredContacts = computed(() => {
    const query = search.value.trim().toLowerCase();
    return query ? contactRows.value.filter(row => matchesSearch(row, query)) : contactRows.value;
  });

  const filteredUsed = computed(() => {
    const query = search.value.trim().toLowerCase();
    return query ? usedRows.value.filter(row => matchesSearch(row, query)) : usedRows.value;
  });

  const isEmptyList = computed(() => filteredContacts.value.length === 0 && filteredUsed.value.length === 0);

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
          :placeholder="t('manageBlocks.dialog.search_placeholder')"
          hide-bottom-space
        >
          <template #prepend-icon>
            <ui3n-icon icon="round-search" />
          </template>
        </ui3n-input>

        <div :class="$style.list">
          <template
            v-for="group in [
              { key: 'contacts', label: t('manageBlocks.dialog.section.contacts'), rows: filteredContacts },
              { key: 'used', label: t('manageBlocks.dialog.section.used'), rows: filteredUsed },
            ]"
            :key="group.key"
          >
            <div
              v-if="group.rows.length > 0"
              :class="$style.sectionLabel"
            >
              {{ group.label }}
            </div>

            <div
              v-for="row in group.rows"
              :key="row.id"
              :class="$style.row"
            >
              <contact-icon
                :size="36"
                :name="row.displayName"
                readonly
                :class="$style.avatar"
              />

              <div :class="$style.names">
                <div :class="$style.name">
                  {{ row.displayName }}
                  <ui3n-icon
                    v-if="isBlacklisted(row.mail)"
                    icon="round-lock"
                    :width="14"
                    :height="14"
                    color="var(--warning-content-default)"
                  />
                </div>

                <div
                  v-if="row.displayName !== row.mail"
                  :class="$style.mail"
                >
                  {{ row.mail }}
                </div>
              </div>

              <ui3n-button
                type="custom"
                size="small"
                :color="
                  isBlacklisted(row.mail) ? 'var(--success-content-default)' : 'var(--warning-content-default)'
                "
                :text-color="
                  isBlacklisted(row.mail) ? 'var(--success-fill-default)' : 'var(--warning-fill-default)'
                "
                :class="$style.btn"
                @click.stop.prevent="runContactBlocking(row.mail, !isBlacklisted(row.mail))"
              >
                {{ isBlacklisted(row.mail) ? t('dialog.button.unblock') : t('dialog.button.block') }}
              </ui3n-button>
            </div>
          </template>

          <div
            v-if="isEmptyList"
            :class="$style.empty"
          >
            {{ t('manageBlocks.dialog.nobody') }}
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
          {{ t('dialog.button.close') }}
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
  .body {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: var(--spacing-m);
  }

  .search {
    width: calc(100% - var(--spacing-l));
    flex-shrink: 0;
    margin-bottom: var(--spacing-m);
  }

  .list {
    position: relative;
    width: 100%;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }

  .sectionLabel {
    padding: var(--spacing-s) 0 var(--spacing-xs);
    font-size: var(--font-12);
    font-weight: 600;
    color: var(--color-text-control-secondary-default);
    text-transform: uppercase;
  }

  .row {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    column-gap: var(--spacing-s);
    padding: var(--spacing-xs) 0;
  }

  .avatar {
    flex-shrink: 0;
  }

  .names {
    flex: 1 1 auto;
    min-width: 0;
  }

  .name {
    display: flex;
    align-items: center;
    column-gap: var(--spacing-xs);
    font-size: var(--font-14);
    font-weight: 500;
    color: var(--color-text-block-primary-default);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mail {
    font-size: var(--font-12);
    color: var(--color-text-block-secondary-default);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .btn {
    flex-shrink: 0;
    min-width: 64px;
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
  }
</style>
