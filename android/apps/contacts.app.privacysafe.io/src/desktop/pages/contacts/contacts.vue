<!--
 Copyright (C) 2020 - 2026 3NSoft Inc.

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
  import { inject, onMounted, ref } from 'vue';
  import { useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import cloneDeep from 'lodash/cloneDeep';
  import { DIALOGS_KEY, type DialogsPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { useTutorialStore } from '@main/common/store/tutorial.store';
  import { useContactsStore } from '@main/common/store/contacts.store';
  import ContactsToolbar from '@main/common/components/contacts-toolbar.vue';
  import ShareToolbar from '@main/common/components/share-toolbar.vue';
  import ContactList from '@main/desktop/components/contacts/contact-list.vue';
  import ContactPlaceholder from '@main/desktop/components/contacts/contact-placeholder.vue';
  import ShareDialog from '@main/common/components/dialogs/share-dialog.vue';
  import SharePreparingDialog from '@main/common/components/dialogs/share-preparing-dialog.vue';
  import { NEW_EMPTY_CONTACT_ID } from '@main/common/constants';
  import type { ShareChannel } from '@main/types';

  const { t } = useI18n();
  const router = useRouter();

  const dialog = inject<DialogsPlugin>(DIALOGS_KEY)!;

  const { checkAndRunSteps } = useTutorialStore();

  const contactsStore = useContactsStore();
  const { unblockedContacts, messageableContacts } = storeToRefs(contactsStore);

  const searchText = ref<string>('');
  const markedContacts = ref<string[]>([]);
  const isShareToolbarOpen = ref(false);

  function onInput(text: string) {
    searchText.value = text;
  }

  async function addNewContact() {
    await router.push({ name: 'contacts' });
    setTimeout(() => router.push({ name: 'contact', params: { id: NEW_EMPTY_CONTACT_ID } }), 250);
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
    const res = await dialog.$openDialog<{ recipient: string; channel: ShareChannel }>(ShareDialog, {
      messageableContacts: messageableContacts.value,
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
      const shareRes = await dialog.$openDialog<boolean>(SharePreparingDialog, {
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
  <div :class="$style.contacts">
    <div :class="$style.aside">
      <contacts-toolbar
        @add="addNewContact"
        @input="onInput"
        @share="() => showShareToolbar(true)"
      />

      <share-toolbar
        v-if="isShareToolbarOpen"
        :marked-contacts="markedContacts"
        :unblocked-contacts="Object.keys(unblockedContacts)"
        @cancel="() => showShareToolbar(false)"
        @update:marked-contacts="onMarkedContactsUpdate"
        @share="runShareContacts"
      />

      <div :class="[$style.asideBody, isShareToolbarOpen && $style.shorter]">
        <contact-list
          :search-text="searchText"
          :marked-contacts="markedContacts"
          :share-mode="isShareToolbarOpen"
          @select="markContact"
        />
      </div>
    </div>

    <div :class="$style.content">
      <router-view v-slot="{ Component }">
        <transition>
          <component
            :is="Component"
            v-if="Component"
          />

          <contact-placeholder v-else />
        </transition>
      </router-view>
    </div>
  </div>
</template>

<style lang="scss" module>
  .contacts {
    --contacts-aside-width: calc(var(--column-size) * 4);

    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: space-between;
    align-items: stretch;
  }

  .aside {
    position: relative;
    width: var(--contacts-aside-width);
    border-right: 1px solid var(--color-border-block-primary-default);
  }

  .asideBody {
    position: relative;
    width: 100%;
    height: calc(100% - 112px);
    padding: var(--spacing-xs) 0;
    user-select: none;

    &.shorter {
      height: calc(100% - 112px - 56px);
    }
  }

  .content {
    position: relative;
    width: calc(100% - var(--contacts-aside-width));
    height: 100%;
  }
</style>
