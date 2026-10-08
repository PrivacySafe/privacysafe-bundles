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
  import { onMounted, ref } from 'vue';
  import { useRouter } from 'vue-router';
  import { useTutorialStore } from '@main/common/store/tutorial.store';
  import ContactsToolbar from '@main/common/components/contacts-toolbar.vue';
  import ContactList from '@main/desktop/components/contacts/contact-list.vue';
  import ContactPlaceholder from '@main/desktop/components/contacts/contact-placeholder.vue';
  import { NEW_EMPTY_CONTACT_ID } from '@main/common/constants';

  const router = useRouter();

  const { checkAndRunSteps } = useTutorialStore();

  const searchText = ref<string>('');

  function onInput(text: string) {
    searchText.value = text;
  }

  async function addNewContact() {
    await router.push({ name: 'contacts' });
    setTimeout(() => router.push({ name: 'contact', params: { id: NEW_EMPTY_CONTACT_ID } }), 250);
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
      />

      <div :class="$style.asideBody">
        <contact-list :search-text="searchText" />
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
  }

  .content {
    position: relative;
    width: calc(100% - var(--contacts-aside-width));
    height: 100%;
  }
</style>
