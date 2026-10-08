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
  import { computed } from 'vue';
  import { useRoute } from 'vue-router';
  import { storeToRefs } from 'pinia';
  import { Ui3nList } from '@v1nt1248/3nclient-lib';
  import { useContactsStore } from '@main/common/store/contacts.store';
  import {
    filterContacts,
    groupByFirstLetter,
    initialLetters,
  } from '@main/common/utils/contact-list-view';
  import ListItem from '@main/common/components/contact-list-item.vue';
  import CustomScrollBar from '@main/common/components/custom-scroll-bar.vue';

  const props = defineProps<{
    searchText?: string;
  }>();

  const route = useRoute();

  const contactsStore = useContactsStore();
  const { contacts } = storeToRefs(contactsStore);

  const selectedContactId = computed(() => route.params.id as string);

  const filteredList = computed(() => filterContacts(contacts.value, props.searchText));
  const contactListByLetters = computed(() => groupByFirstLetter(filteredList.value));
  const contactsInitialLetters = computed(() => initialLetters(contactListByLetters.value));

  const isDataLoaded = computed(() => contactsInitialLetters.value.length > 0);
</script>

<template>
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
              :selected-contact-ids="selectedContactId ? [selectedContactId] : []"
            />
          </template>
        </ui3n-list>
      </template>
    </ui3n-list>
  </custom-scroll-bar>
</template>

<style lang="scss" module>
  @use '@main/common/assets/styles/_mixins' as mixins;

  .title {
    position: relative;
    width: var(--spacing-l);
    text-align: center;
    padding-left: calc(var(--spacing-s) * 1.5);
    font-size: var(--font-16);
    font-weight: 600;
    color: var(--color-text-block-accent-default);
  }
</style>
