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
  import { computed, inject, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import size from 'lodash/size';
  import cloneDeep from 'lodash/cloneDeep';
  import {
    DIALOGS_KEY,
    DialogsPlugin,
    NOTIFICATIONS_KEY,
    NotificationsPlugin,
  } from '@v1nt1248/3nclient-lib/plugins';
  import {
    Ui3nButton,
    Ui3nCheckbox,
    Ui3nIcon,
    type Ui3nCheckboxValue,
    Ui3nInput,
    Ui3nList,
  } from '@v1nt1248/3nclient-lib';
  import { useRouting } from '../composables/useRouting';
  import { useAppStore } from '@main/common/store/app.store';
  import { useContactsStore } from '@main/common/store/contacts.store';
  import { useTutorialStore } from '@main/common/store/tutorial.store';
  import { filterContacts, groupByFirstLetter, initialLetters } from '@main/common/utils/contact-list-view';
  import type { PersonView, ShareChannel } from '@main/types';
  import ConfirmationDialog from '@main/common/components/dialogs/confirmation-dialog.vue';
  import ListItem from '@main/common/components/contact-list-item.vue';
  import CustomScrollBar from '@main/common/components/custom-scroll-bar.vue';
  import ShareDialog from '@main/common/components/dialogs/share-dialog.vue';
  import ShareToolbar from '@main/common/components/share-toolbar.vue';
  import SharePreparingDialog from '@main/common/components/dialogs/share-preparing-dialog.vue';

  const dialogs = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const notification = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const { t } = useI18n();
  const { goToNew } = useRouting();

  const { user } = storeToRefs(useAppStore());
  const contactsStore = useContactsStore();
  const { contacts, unblockedContacts, messageableContacts } = storeToRefs(contactsStore);
  const { deleteContacts } = contactsStore;

  const { checkAndRunSteps } = useTutorialStore();

  const searchText = ref<string>('');
  const selectedContacts = ref<string[]>([]);
  const markedContacts = ref<string[]>([]);
  const isShareToolbarOpen = ref(false);

  const selectedContactIds = computed(() => {
    if (isShareToolbarOpen.value) {
      return markedContacts.value ?? [];
    }

    return selectedContacts.value ?? [];
  });

  const filteredContactList = computed(() => filterContacts(contacts.value, searchText.value));
  const contactListByLetters = computed(() => groupByFirstLetter(filteredContactList.value));
  const contactsInitialLetters = computed(() => initialLetters(contactListByLetters.value));

  const areAllFilteredContactsSelected = computed(() => {
    const isUserInFilteredList = !!filteredContactList.value.find(c => c.mail === user.value);

    return isUserInFilteredList
      ? size(selectedContacts.value) === size(filteredContactList.value) - 1
      : size(selectedContacts.value) === size(filteredContactList.value);
  });

  const isDataLoaded = computed(() => contactsInitialLetters.value.length > 0);

  function selectContact(contact: PersonView & { displayName: string }) {
    if (isShareToolbarOpen.value) {
      markContact(contact.id);
      return;
    }

    const contactIndex = selectedContacts.value.findIndex(cId => cId === contact.id);
    if (contactIndex === -1) {
      selectedContacts.value.push(contact.id);
    } else {
      selectedContacts.value.splice(contactIndex, 1);
    }
  }

  function clearSelectedList() {
    selectedContacts.value = [];
  }

  function toggleSelectedAll(value: Ui3nCheckboxValue) {
    if (value) {
      selectedContacts.value = filteredContactList.value.reduce((res, c) => {
        if (c.mail !== user.value) {
          res.push(c.id);
        }

        return res;
      }, [] as string[]);
    } else {
      selectedContacts.value = [];
    }
  }

  async function deleteSelectedContacts() {
    const res = await dialogs.$openDialog(ConfirmationDialog, {
      component: ConfirmationDialog,
      dialogText: t('confirmation.delete.multiple', { count: `<b>${size(selectedContacts.value)}</b>` }),
      dialogProps: {
        title: t('contact.delete.title', 2),
        width: 300,
        confirmButtonText: t('contact.delete.confirmBtn'),
        cancelButtonText: t('contact.delete.cancelBtn'),
      },
    });

    const { event } = res;
    if (event === 'confirm') {
      try {
        await deleteContacts(selectedContacts.value);
        notification.$createNotice({
          type: 'success',
          content: t('contact.delete.success', 2),
        });
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (err) {
        notification.$createNotice({
          type: 'error',
          content: t('contact.delete.error', 2),
        });
      }
    }

    clearSelectedList();
  }

  function createNewContact() {
    goToNew();
  }

  function showShareToolbar(value: boolean) {
    if (value) {
      markedContacts.value = cloneDeep(Object.keys(unblockedContacts.value));
    }
    isShareToolbarOpen.value = value;
  }

  function onMarkedContactsUpdate(v: string[]) {
    markedContacts.value = v;
  }

  function markContact(id: string) {
    const index = markedContacts.value.findIndex(contactId => contactId === id);
    if (index >= 0) {
      markedContacts.value.splice(index, 1);
    } else {
      markedContacts.value.push(id);
    }
  }

  async function runShareContacts() {
    const res = await dialogs.$openDialog<{ recipient: string; channel: ShareChannel }>(ShareDialog, {
      messageableContacts: messageableContacts.value,
      isMobileFormFactor: true,
      dialogProps: {
        title: t('share.title'),
        confirmButton: false,
        cancelButton: false,
        cssStyle: { width: '380px', maxWidth: '95%' },
      },
    });

    const { event, data } = res;
    if (event === 'close') {
      onMarkedContactsUpdate([]);
      showShareToolbar(false);
    } else if (event === 'confirm' && data) {
      const { recipient, channel } = data;
      const shareRes = await dialogs.$openDialog<boolean>(SharePreparingDialog, {
        contactIds: [...markedContacts.value],
        recipient,
        channel,
        dialogProps: {
          title: t('share.progress.title'),
          confirmButton: false,
          cancelButton: false,
          closeOnClickOverlay: false,
          closeOnEsc: false,
          cssStyle: { width: '380px', maxWidth: '95%' },
        },
      });

      if (shareRes.event === 'confirm') {
        onMarkedContactsUpdate([]);
        showShareToolbar(false);
      }
    }
  }

  onMounted(() => {
    void checkAndRunSteps();
  });
</script>

<template>
  <div :class="$style.list">
    <div
      v-if="selectedContacts.length > 0"
      :class="$style.toolbar"
    >
      <div :class="$style.toolbarBlock">
        <ui3n-button
          type="icon"
          color="var(--color-bg-block-primary-default)"
          icon="round-arrow-back"
          icon-color="var(--color-icon-block-primary-default)"
          icon-size="20"
          @click="clearSelectedList"
        />

        <span :class="$style.info">{{ size(selectedContacts) }}</span>

        <ui3n-checkbox
          :model-value="areAllFilteredContactsSelected"
          @change="toggleSelectedAll"
        />

        <span :class="$style.info">
          {{ areAllFilteredContactsSelected ? t('action.deselect.all') : t('action.select.all') }}
        </span>
      </div>

      <ui3n-button
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="trash-can"
        icon-color="var(--warning-content-default)"
        @click="deleteSelectedContacts"
      />
    </div>

    <div :class="$style.search">
      <ui3n-input
        v-model="searchText"
        size="large"
        :placeholder="t('contacts.search.placeholder')"
        clearable
        icon="round-search"
        icon-color="var(--color-icon-control-secondary-default)"
        hide-bottom-space
        :disabled="size(selectedContacts) > 0"
      />

      <ui3n-button
        type="secondary"
        size="large"
        square
        :class="$style.share"
        @click="() => showShareToolbar(true)"
      >
        <ui3n-icon
          icon="share-variant-outline"
          size="32"
          color="var(--color-icon-button-secondary-default)"
        />
      </ui3n-button>
    </div>

    <share-toolbar
      v-if="isShareToolbarOpen"
      :marked-contacts="markedContacts"
      :unblocked-contacts="Object.keys(unblockedContacts)"
      is-mobile-form-factor
      @cancel="() => showShareToolbar(false)"
      @update:marked-contacts="onMarkedContactsUpdate"
      @share="runShareContacts"
    />

    <div :class="[$style.content, isShareToolbarOpen && $style.shorter]">
      <custom-scroll-bar v-if="isDataLoaded">
        <ui3n-list
          :sticky="false"
          :items="contactsInitialLetters"
        >
          <template #item="{ item }">
            <ui3n-list
              :items="contactListByLetters[item.id]"
              key-field="mail"
            >
              <template #title>
                <div :class="$style.title">
                  {{ item.label.toUpperCase() }}
                </div>
              </template>

              <template #item="{ item: contact }">
                <list-item
                  :item="contact"
                  :share-mode="isShareToolbarOpen"
                  :selected-contact-ids="selectedContactIds"
                  is-mobile-form-factor
                  @select="() => selectContact(contact)"
                />
              </template>
            </ui3n-list>
          </template>
        </ui3n-list>
      </custom-scroll-bar>
    </div>

    <ui3n-button
      data-tutorial="createBtn"
      type="icon"
      color="var(--color-bg-button-primary-default)"
      size="large"
      icon="round-plus"
      icon-color="var(--color-icon-button-primary-default)"
      icon-size="32"
      :class="$style.createBtn"
      @click="createNewContact"
    />
  </div>
</template>

<style lang="scss" module>
  @use '@main/common/assets/styles/_mixins' as mixins;

  .list {
    position: relative;
    width: 100%;
    height: 100%;
    padding: var(--spacing-m);
    overflow: hidden;
    background-color: var(--color-bg-block-primary-default);
  }

  .toolbar {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: var(--spacing-xxl);
    background-color: var(--color-bg-block-primary-default);
    border-bottom: 1px solid var(--color-border-block-primary-default);
    z-index: 5;
    padding: 0 var(--spacing-s);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .toolbarBlock {
    display: flex;
    justify-content: flex-start;
    align-items: center;
  }

  .info {
    font-size: var(--font-12);
    font-weight: 600;
    color: var(--color-text-control-primary-default);
    padding: 0 var(--spacing-s);
  }

  .search {
    display: flex;
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-s);
    margin-bottom: var(--spacing-m);
    user-select: none;

    .share {
      --ui3n-button-padding-large: 0 8px 0 4px !important;
    }
  }

  .content {
    position: relative;
    width: calc(100% + 12px);
    height: calc(100% - 64px);
    margin-right: -12px;

    &.shorter {
      height: calc(100% - 64px - 56px);
    }
  }

  .title {
    position: relative;
    width: var(--spacing-ml);
    text-align: center;
    font-size: var(--font-16);
    font-weight: 600;
    color: var(--color-text-block-accent-default);
    user-select: none;
  }

  .createBtn {
    position: absolute !important;
    bottom: var(--spacing-ml);
    right: var(--spacing-ml);
    z-index: 2;
  }
</style>
