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
<script setup lang="ts">
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton, Ui3nInput } from '@v1nt1248/3nclient-lib';

  defineProps<{
    modelValue: string;
  }>();
  const emits = defineEmits<{
    (event: 'update:modelValue', value: string): void;
    (event: 'create:group'): void;
  }>();

  const { t } = useI18n();
</script>

<template>
  <div :class="$style.toolbar">
    <ui3n-input
      :model-value="modelValue"
      :placeholder="t('list.search')"
      icon="round-search"
      clearable
      hide-bottom-space
      :class="$style.search"
      @update:model-value="emits('update:modelValue', $event)"
    />

    <div :class="$style.block">
      <ui3n-button
        type="secondary"
        icon="round-plus"
        icon-position="left"
        icon-color="var(--color-icon-button-secondary-default)"
        icon-size="16"
        @click.stop.prevent="emits('create:group')"
      >
        {{ t('list.createGroup') }}
      </ui3n-button>
    </div>
  </div>
</template>

<style lang="scss" module>
  .toolbar {
    display: flex;
    width: 100%;
    height: 100%;
    padding: 0 var(--spacing-m);
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-m);

    .search {
      position: relative;
      width: 480px;
      max-width: 60%;
    }

    .block {
      display: flex;
      justify-content: center;
      align-items: center;
      column-gap: var(--spacing-s);
    }
  }
</style>
