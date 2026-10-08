<!--
 Copyright (C) 2020 - 2024 3NSoft Inc.

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
  import { ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton, Ui3nInput } from '@v1nt1248/3nclient-lib';

  defineProps<{
    disabled?: boolean;
  }>();
  const emit = defineEmits(['add', 'input']);

  const { t } = useI18n();

  const searchText = ref<string>('');

  function addNewContact() {
    emit('add');
  }

  function onInput(ev: string) {
    emit('input', ev);
  }
</script>

<template>
  <div :class="$style.contactsToolbar">
    <ui3n-button
      data-tutorial="createBtn"
      :class="$style.addBtn"
      :disabled="disabled"
      @click="addNewContact"
    >
      + {{ t('app.btn.add') }}
    </ui3n-button>

    <div :class="$style.search">
      <ui3n-input
        v-model="searchText"
        :placeholder="t('contacts.search.placeholder')"
        clearable
        icon="round-search"
        icon-color="var(--color-icon-control-secondary-default)"
        :disabled="disabled"
        @input="onInput"
        @clear="onInput('')"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .contactsToolbar {
    position: relative;
    width: 100%;
    height: 104px;
    padding: var(--spacing-m) var(--spacing-m) var(--spacing-s);

    input {
      user-select: none;
    }
  }

  .addBtn {
    margin-bottom: var(--spacing-m);
  }

  .search {
    position: relative;
    width: 100%;
    height: var(--spacing-l);
  }
</style>
