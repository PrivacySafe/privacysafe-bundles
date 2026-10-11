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
  import { ref, computed, inject, onBeforeMount } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import keyBy from 'lodash/keyBy';
  import { capitalize } from '@v1nt1248/3nclient-lib/utils';
  import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import {
    Ui3nButton,
    Ui3nChip,
    Ui3nDialog,
    type Ui3nDialogComponentProps,
    type Ui3nDialogEvent,
    Ui3nInput,
    Ui3nIcon,
    Ui3nProgressCircular,
    Ui3nTooltip,
  } from '@v1nt1248/3nclient-lib';
  import type { ChatIdObj, ContactsException, PersonView } from '~/index';
  import { useChatsStore } from '@main/common/store/chats.store';
  import { useAppStore } from '@main/common/store/app.store';
  import { useContactsStore } from '@main/common/store/contacts.store';
  import ContactList from '@main/common/components/contacts/contact-list.vue';
  import ContactIcon from '@main/common/components/contacts/contact-icon.vue';

  defineProps<{
    dialogProps?: Ui3nDialogComponentProps<ChatIdObj>;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { event: Ui3nDialogEvent; data?: ChatIdObj }): void;
  }>();

  const { t } = useI18n();
  const notification = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const { user } = storeToRefs(useAppStore());

  const contactsStore = useContactsStore();
  const { contactList: allContacts } = storeToRefs(contactsStore);
  const { fetchContacts, addContact } = contactsStore;

  const { createNewOneToOneChat, createNewGroupChat } = useChatsStore();

  const isProcessing = ref(false);
  const isAddingContact = ref(false);
  const searchText = ref<string>('');
  const selectedContacts = ref<(PersonView & { displayName: string })[]>([]);
  const groupChatModeStep = ref(1);
  const chatName = ref('');

  const contacts = computed<Record<string, PersonView & { displayName: string }>>(() =>
    keyBy(allContacts.value, 'id'),
  );

  const nonSelectableContacts = computed(() => {
    const me = allContacts.value.find(c => c.mail === user.value);
    return me ? [me] : [];
  });

  const isGroupChatMode = computed(() => selectedContacts.value.length > 1);

  const actionLeftBtnText = computed(() =>
    isGroupChatMode.value
      ? t(groupChatModeStep.value === 1 ? 'app.text.close' : 'app.text.back')
      : t('app.text.close'),
  );

  const actionRightBtnText = computed(() =>
    isGroupChatMode.value
      ? t(groupChatModeStep.value === 1 ? 'app.text.next' : 'app.text.create')
      : t('app.text.create'),
  );

  function getSelectedContactIndex(contact: PersonView & { displayName: string }): number {
    return selectedContacts.value.findIndex(c => c.mail === contact.mail);
  }

  async function selectContacts(contact: PersonView & { displayName: string }) {
    const contactIndex = getSelectedContactIndex(contact);
    if (contactIndex === -1) {
      selectedContacts.value.push(contact);
    } else {
      selectedContacts.value.splice(contactIndex, 1);
    }
  }

  function onActionLeftBtnClick() {
    if (isGroupChatMode.value && groupChatModeStep.value === 2) {
      groupChatModeStep.value = 1;
    } else {
      emits('action', { event: 'close' });
    }
  }

  async function onActionRightBtnClick() {
    if (isGroupChatMode.value && groupChatModeStep.value === 1) {
      groupChatModeStep.value = 2;
      return;
    }

    try {
      isProcessing.value = true;
      let chatId: ChatIdObj | undefined;
      if (isGroupChatMode.value) {
        const groupMembers = selectedContacts.value.reduce(
          (res, c) => {
            const { mail } = c;
            res[mail] = { hasAccepted: false };
            return res;
          },
          { [user.value]: { hasAccepted: true } },
        );

        const name = chatName.value.trim();
        chatId = await createNewGroupChat(name, groupMembers);
      } else {
        const { displayName: name, mail: peerAddr } = selectedContacts.value[0];
        chatId = await createNewOneToOneChat(name, peerAddr);
      }

      emits('action', { event: 'confirm', data: chatId! });
    } finally {
      isProcessing.value = false;
    }
  }

  async function addNewContact(mail: string) {
    if (isAddingContact.value) {
      return;
    }
    isAddingContact.value = true;
    try {
      await addContact(mail);
    } catch (err) {
      // Called from an emit listener, so a rejection here used to end up as
      // an Uncaught (in promise) with nothing shown to the user.
      const contactsErr = err as Partial<ContactsException>;
      const key = contactsErr?.contactAlreadyExists
        ? 'chat.contact.add.error.exists'
        : (contactsErr?.failASMailCheck
          ? 'chat.contact.add.error.check_failed'
          : 'chat.contact.add.error.unknown');
      console.error(`Failed to add contact ${mail}:`, err);
      notification.$createNotice({
        type: 'error',
        content: t(key, { addr: mail }),
      });
    } finally {
      isAddingContact.value = false;
    }
  }

  onBeforeMount(async () => {
    await fetchContacts();
  });
</script>

<template>
  <ui3n-dialog
    v-bind="dialogProps"
    :class="$style.chatCreateDialog"
    @action="emits('action', $event)"
  >
    <template #body>
      <div :class="$style.chatCreateDialogBody">
        <template v-if="!isGroupChatMode || (isGroupChatMode && groupChatModeStep === 1)">
          <ui3n-input
            v-model="searchText"
            clearable
            :disabled="isAddingContact"
            :class="$style.chatCreateDialogInput"
          >
            <template #prepend-icon>
              <ui3n-icon icon="round-search" />
            </template>
          </ui3n-input>

          <div :class="$style.chatCreateDialogContent">
            <template v-if="selectedContacts.length > 1">
              <div :class="$style.chatCreateDialogSelectedInfo">
                {{ t('chat.create.dialog.selected.contacts') }}: {{ selectedContacts.length }}/{{
                  Object.values(allContacts).length
                }}
              </div>

              <div :class="$style.chatCreateDialogSelectedBody">
                <template
                  v-for="contact in selectedContacts"
                  :key="contact.id"
                >
                  <ui3n-tooltip
                    placement="top"
                    :content="contact.mail"
                  >
                    <ui3n-chip
                      :max-width="104"
                      :class="$style.chatCreateDialogSelectedItem"
                    >
                      {{ contact.displayName }}
                      <template #left>
                        <contact-icon
                          :name="contact.displayName"
                          :size="24"
                          :readonly="true"
                        />
                      </template>
                    </ui3n-chip>
                  </ui3n-tooltip>
                </template>
              </div>
            </template>
          </div>

          <div :class="$style.chatCreateDialogContentList">
            <contact-list
              :contact-list="Object.values(contacts)"
              :search-text="searchText"
              :selected-contacts="selectedContacts"
              :non-selectable-contacts="nonSelectableContacts"
              :adding="isAddingContact"
              @select="selectContacts"
              @add:new="addNewContact"
            />
          </div>
        </template>

        <template v-else>
          <ui3n-input
            v-model="chatName"
            :label="t('chat.create.group.name.label')"
            :class="$style.chatCreateDialogInput"
          />

          <div :class="$style.chatCreateDialogContentList">
            <contact-list
              :contact-list="selectedContacts"
              :without-anchor="true"
              :readonly="true"
            />
          </div>
        </template>
      </div>
    </template>

    <template #actions>
      <div :class="$style.chatCreateDialogActions">
        <ui3n-button
          type="secondary"
          :disabled="isProcessing"
          @click="onActionLeftBtnClick"
        >
          {{ capitalize(actionLeftBtnText) }}
        </ui3n-button>

        <ui3n-button
          v-if="selectedContacts.length > 0"
          :disabled="(isGroupChatMode && groupChatModeStep === 2 && !chatName) || isProcessing"
          @click="onActionRightBtnClick"
        >
          {{ capitalize(actionRightBtnText) }}
        </ui3n-button>
      </div>
    </template>

    <template
      v-if="isProcessing"
      #loading
    >
      <div
        v-if="isProcessing"
        :class="$style.processing"
      >
        <ui3n-progress-circular
          indeterminate
          size="80"
        />
      </div>
    </template>
  </ui3n-dialog>
</template>

<style lang="scss" module>
  .chatCreateDialog {
    --chat-create-dialog-actions-height: 64px;

    position: relative;
    width: 100%;
    height: 90dvh;
    border-radius: var(--spacing-m);
    background-color: var(--color-bg-block-primary-default);
  }

  .chatCreateDialogBody {
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    padding: var(--spacing-m);
  }

  .chatCreateDialogActions {
    position: relative;
    height: var(--chat-create-dialog-actions-height);
    padding: 0 var(--spacing-m);
    display: flex;
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-s);

    button {
      border-radius: var(--spacing-m) !important;
    }
  }

  .chatCreateDialogInput {
    width: calc(100% - var(--spacing-m));
    margin-bottom: var(--spacing-s);

    :global(.ui3n-icon) {
      top: 10px;
    }
  }

  .chatCreateDialogContent {
    position: relative;
    width: 100%;
  }

  .chatCreateDialogSelectedInfo {
    font-size: var(--font-10);
    font-weight: 500;
    color: var(--color-text-block-secondary-default);
    margin-bottom: var(--spacing-s);
  }

  .chatCreateDialogSelectedBody {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-start;
    align-items: flex-start;
    margin-bottom: var(--spacing-s);
  }

  .chatCreateDialogSelectedItem {
    --font-size-sm: var(--font-10);
    --chip-text-small-margin: 0;
    --chip-small-padding: 0 var(--base-size);

    max-width: 104px;
    margin: 0 var(--spacing-xs) var(--spacing-xs) 0;
    padding-left: 0 !important;
  }

  .chatCreateDialogContentList {
    position: relative;
    width: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    flex-grow: 2;

    & > div > div > div {
      padding-right: var(--spacing-m) !important;
    }
  }

  .processing {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    pointer-events: none;
    background-color: var(--black-12);
  }
</style>
