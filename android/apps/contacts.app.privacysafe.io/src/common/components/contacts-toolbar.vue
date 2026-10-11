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
  import { Ui3nButton, Ui3nIcon, Ui3nInput } from '@v1nt1248/3nclient-lib';

  defineProps<{
    disabled?: boolean;
  }>();
  const emits = defineEmits(['add', 'input', 'share']);

  const { t } = useI18n();

  const searchText = ref<string>('');

  function addNewContact() {
    emits('add');
  }

  function onInput(ev: string) {
    emits('input', ev);
  }
</script>

<template>
  <div :class="$style.contactsToolbar">
    <div :class="$style.actions">
      <ui3n-button
        data-tutorial="createBtn"
        :disabled="disabled"
        @click="addNewContact"
      >
        + {{ t('app.btn.add') }}
      </ui3n-button>

      <ui3n-button
        type="secondary"
        square
        :class="$style.share"
        @click="() => emits('share')"
      >
        <ui3n-icon
          icon="share-variant-outline"
          size="20"
          color="var(--color-icon-button-secondary-default)"
        />
      </ui3n-button>
    </div>

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

  .actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-m);

    .share {
      --ui3n-button-padding-regular: 0 6px 0 4px;
    }
  }

  .search {
    position: relative;
    width: 100%;
    height: var(--spacing-l);
  }
</style>
