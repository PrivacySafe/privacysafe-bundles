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
  import { computed, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { Ui3nButton, Ui3nMenu } from '@v1nt1248/3nclient-lib';
  import { useFsStore } from '@/store';
  import type { RootFsFolderView } from '@shared/types';

  const props = defineProps<{
    modelValue: string;
    availableFsFolders: RootFsFolderView[];
  }>();

  const emits = defineEmits<{
    (event: 'update:modelValue', value: string): void;
  }>();

  const { t } = useI18n();

  const { fsFolderList } = storeToRefs(useFsStore());

  const isMenuOpen = ref(false);

  const selectedFsFolderName = computed(() => {
    if (!props.modelValue) {
      return '-';
    }

    const fsFolder = fsFolderList.value.find(f => f.id === props.modelValue);
    return fsFolder?.name || '-';
  });

  function selectItem(id: string) {
    if (id !== props.modelValue) {
      emits('update:modelValue', id);
    }
  }
</script>

<template>
  <ui3n-menu
    v-model="isMenuOpen"
    :offset-x="-4"
    :offset-y="4"
  >
    <ui3n-button
      type="custom"
      color="var(--color-bg-control-secondary-default)"
      text-color="var(--color-text-control-primary-default)"
      :icon="isMenuOpen ? 'round-keyboard-arrow-up': 'round-keyboard-arrow-down'"
      icon-color="var(--color-icon-button-tritery-default)"
      icon-position="right"
      :class="$style.fsSystemsSelector"
    >
      {{ t(selectedFsFolderName) }}
    </ui3n-button>

    <template #menu>
      <div
        v-for="fsFolder in availableFsFolders"
        :key="fsFolder.id"
        :class="[$style.item, fsFolder.id === modelValue && $style.selected]"
        @click="selectItem(fsFolder.id)"
      >
        {{ t(fsFolder.name) }}
      </div>
    </template>
  </ui3n-menu>
</template>

<style lang="scss" module>
  .fsSystemsSelector {
    --selector-width: 210px;

    position: relative;
    justify-content: space-between !important;
    width: var(--selector-width) !important;
    padding-left: var(--spacing-s) !important;
    font-size: var(--font-11) !important;
  }

  .item {
    display: flex;
    height: var(--spacing-l);
    width: 210px;
    justify-content: flex-start;
    align-items: center;
    padding: 0 var(--spacing-s);
    font-size: var(--font-13);
    color: var(--color-text-control-primary-default);

    &:hover {
      background-color: var(--color-bg-control-primary-hover);
      color: var(--color-text-control-accent-default);
      cursor: pointer;
    }
  }

  .selected {
    color: var(--color-text-control-accent-default);
  }
</style>
