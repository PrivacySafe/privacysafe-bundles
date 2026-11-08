<!--
 Copyright (C) 2024 3NSoft Inc.

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
import { computed, VNode } from 'vue';
import { useI18n } from 'vue-i18n';
import { Ui3nButton, Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
import { mailReg } from '@v1nt1248/3nclient-lib/utils';
import type { PersonView } from '~/index';
import ContactListItem from './contact-list-item.vue';

interface ContactListProps {
  contactList?: (PersonView & { displayName: string })[];
  searchText?: string;
  selectedContacts?: (PersonView & { displayName: string })[];
  nonSelectableContacts?: (PersonView & { displayName: string })[];
  withoutAnchor?: boolean;
  readonly?: boolean;
  /** The parent's "add contact" action is in flight: disable the add button and show a spinner. */
  adding?: boolean;
}

const props = withDefaults(defineProps<ContactListProps>(), {
  contactList: () => [],
  searchText: '',
  selectedContacts: () => [],
  nonSelectableContacts: () => [],
  withoutAnchor: false,
  readonly: false,
  adding: false,
});
const emits = defineEmits<{
  (event: 'select', value: PersonView & { displayName: string }): void,
  (event: 'add:new', value: string): void,
  (event: 'click:right', value: { contactId: string; mail: string }): void,
}>();
defineSlots<{
  extra?: (props: { contactId: string, mail: string }) => VNode;
}>();

const { t } = useI18n();

const contactListByLetters = computed<Record<string, (PersonView & { displayName: string })[]>>(() => {
  return props.contactList
    .filter(c => c.displayName.toLocaleLowerCase().includes(props.searchText.toLocaleLowerCase()))
    .reduce((res, item) => {
      const letter = props.withoutAnchor ? 'one' : item.displayName[0].toUpperCase();
      if (!res[letter]) {
        res[letter] = [];
      }

      res[letter].push(item);
      return res;
    }, {} as Record<string, (PersonView & { displayName: string })[]>);
});
const contactLetters = computed(() => Object.keys(contactListByLetters.value).sort());

const isMailValid = computed<boolean>(() => mailReg.test(props.searchText || ''));

function isContactSelected(contact: PersonView & { displayName: string }): boolean {
  const userIndex = props.selectedContacts.findIndex(u => u.mail === contact.mail);
  return userIndex !== -1;
}

function isContactNonselectable(contact: PersonView & { displayName: string }): boolean {
  const userIndex = props.nonSelectableContacts.findIndex(u => u.mail === contact.mail);
  return userIndex !== -1;
}

function selectContact(contact: PersonView & { displayName: string }) {
  emits('select', contact);
}

function addNewContact(ev: Event) {
  ev.stopPropagation();
  ev.preventDefault();
  if (isMailValid.value && !props.adding) {
    emits('add:new', props.searchText);
  }
}
</script>

<template>
  <div :class="$style.contactList">
    <div
      v-if="Object.keys(contactListByLetters).length"
      :class="$style.contactListContent"
    >
      <div
        v-for="letter in contactLetters"
        :key="letter"
        :class="$style.contactSubList"
      >
        <div
          v-if="letter !== 'one'"
          :class="$style.contactSubListTitle"
        >
          {{ letter }}
        </div>

        <contact-list-item
          v-for="contact in contactListByLetters[letter]"
          :key="contact.id"
          :contact="contact"
          :selected="isContactSelected(contact)"
          :without-anchor="withoutAnchor"
          :readonly="readonly || isContactNonselectable(contact)"
          @click="selectContact"
          @click:right="emits('click:right', $event)"
        >
          <template #extra="{ contactId, mail }">
            <slot
              name="extra"
              :contact-id="contactId"
              :mail="mail"
            />
          </template>
        </contact-list-item>
      </div>
    </div>

    <div
      v-else
      :class="$style.contactListContentInfo"
    >
      <ui3n-button
        type="secondary"
        :size="'small'"
        :disabled="!isMailValid || adding"
        @click="addNewContact"
      >
        <ui3n-progress-circular
          v-if="adding"
          indeterminate
          size="16"
          :class="$style.addSpinner"
        />
        {{ t('chat.contact.add.btn', { addr: searchText }) }}
      </ui3n-button>
    </div>
  </div>
</template>

<style lang="scss" module>
.contactList,
.contactListContent{
  position: relative;
  width: 100%;
}

.contactSubList {
  padding: var(--spacing-xs) 0;
}

.contactSubListTitle {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-block-accent-default);
  line-height: 1;
  margin-bottom: var(--spacing-xs);
}

.contactListContentInfo {
  position: relative;
  width: 100%;
  height: var(--spacing-xxl);
  display: flex;
  justify-content: center;
  align-items: center;
}

.addSpinner {
  margin-right: var(--spacing-xs);
}
</style>
