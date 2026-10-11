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
  import { computed, ref, useTemplateRef, watch } from 'vue';
  import { markSearch } from '@v1nt1248/3nclient-lib/utils';
  import { Ui3nMenu, Ui3nInput, Ui3nHtml as vUi3nHtml, type Nullable } from '@v1nt1248/3nclient-lib';

  const props = defineProps<{
    modelValue: string;
    label?: string;
    placeholder?: string;
    items: string[];
    displayStateMode?: 'error' | 'success';
    displayStateMessage?: string;
    disabled?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'update:modelValue', value: string): void;
    (event: 'open:menu', value: boolean): void;
  }>();

  const isMenuOpen = ref(false);
  const inputEl = ref<Nullable<HTMLInputElement>>(null);
  const menuBodyEl = useTemplateRef<HTMLDivElement>('body');
  const activeItemIndex = ref<Nullable<number>>(null);

  const filteredItems = computed(() =>
    (props.items || []).filter(i => i.toLowerCase().includes(props.modelValue.toLowerCase())),
  );

  function onItemClick(item: string) {
    if (props.disabled) {
      return;
    }

    emits('update:modelValue', item);
    isMenuOpen.value = false;
  }

  function onInput(val: string) {
    emits('update:modelValue', val);
    if (!isMenuOpen.value && filteredItems.value.length > 0) {
      isMenuOpen.value = true;
    }
  }

  function handlePressingDownKey() {
    if (activeItemIndex.value === null) {
      activeItemIndex.value = 0;
      const itemEl = document.getElementById(filteredItems.value[activeItemIndex.value]);
      itemEl && itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      inputEl.value && inputEl.value.focus();
      return;
    }

    if (activeItemIndex.value >= 0 && activeItemIndex.value < filteredItems.value.length - 1) {
      activeItemIndex.value += 1;
      const itemEl = document.getElementById(filteredItems.value[activeItemIndex.value]);
      itemEl && itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      inputEl.value && inputEl.value.focus();
    }
  }

  function handlePressingUpKey() {
    if (activeItemIndex.value === null) {
      activeItemIndex.value = filteredItems.value.length - 1;
      const itemEl = document.getElementById(filteredItems.value[activeItemIndex.value]);
      itemEl && itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      inputEl.value && inputEl.value.focus();
      return;
    }

    if (activeItemIndex.value > 0 && activeItemIndex.value < filteredItems.value.length) {
      activeItemIndex.value -= 1;
      const itemEl = document.getElementById(filteredItems.value[activeItemIndex.value]);
      itemEl && itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      inputEl.value && inputEl.value.focus();
    }
  }

  function handlePressingEscOrTabKeys() {
    isMenuOpen.value = false;
    activeItemIndex.value = null;
    inputEl.value && inputEl.value.blur();
  }

  function handlePressingEnterKey() {
    if (activeItemIndex.value === null && !isMenuOpen.value) {
      isMenuOpen.value = true;
      activeItemIndex.value = 0;
      menuBodyEl.value && menuBodyEl.value.focus();
      return;
    }

    if (activeItemIndex.value === null && isMenuOpen.value && props.modelValue) {
      // TODO
      return;
    }

    if (activeItemIndex.value !== null) {
      const item = filteredItems.value[activeItemIndex.value!];
      onItemClick(item);
      activeItemIndex.value = null;
    }
  }

  function onKeydown(event: KeyboardEvent, key: 'down' | 'up' | 'esc' | 'enter' | 'tab') {
    switch (key) {
      case 'down':
        event.preventDefault();
        event.stopPropagation();
        handlePressingDownKey();
        break;
      case 'up':
        event.preventDefault();
        event.stopPropagation();
        handlePressingUpKey();
        break;
      case 'esc':
      case 'tab':
        handlePressingEscOrTabKeys();
        break;
      case 'enter':
        event.preventDefault();
        event.stopPropagation();
        handlePressingEnterKey();
        break;
    }
  }

  watch(
    () => isMenuOpen.value,
    (val, oldVal) => {
      if (val && val !== oldVal) {
        if (props.modelValue) {
          const selectedItemIndex = filteredItems.value.findIndex(
            i => i.toLowerCase() === props.modelValue.toLowerCase(),
          );
          activeItemIndex.value = selectedItemIndex || 0;
        }
      } else {
        activeItemIndex.value = null;
      }
      emits('open:menu', !!val);
    },
  );

  watch(
    () => filteredItems.value.length,
    () => {
      activeItemIndex.value = null;
    },
  );
</script>

<template>
  <div :class="$style.loginSelector">
    <ui3n-menu
      v-model="isMenuOpen"
      :offset-x="-2"
      :offset-y="-12"
      position-autoupdate
      :content-border-radius="8"
      :content-styles="{ width: '100%' }"
      :class="$style.menu"
      :disabled="disabled"
    >
      <div :class="$style.activator">
        <ui3n-input
          :model-value="modelValue"
          :label="label"
          :placeholder="placeholder"
          clearable
          :display-state-mode="displayStateMode"
          :display-state-message="displayStateMessage"
          :disabled="disabled"
          @keydown.down="onKeydown($event, 'down')"
          @keydown.up="onKeydown($event, 'up')"
          @keydown.tab="onKeydown($event, 'tab')"
          @keydown.esc="onKeydown($event, 'esc')"
          @keydown.enter="onKeydown($event, 'enter')"
          @init="inputEl = $event"
          @update:model-value="onInput"
        />
      </div>

      <template #menu>
        <div
          ref="body"
          :class="[$style.body, !filteredItems.length && $style.empty]"
        >
          <div
            v-for="(item, index) in filteredItems"
            :id="item"
            :key="item"
            v-ui3n-html="markSearch(item, modelValue || '')"
            :class="[
              $style.item,
              activeItemIndex === index && $style.itemSelected,
              disabled && $style.itemDisabled,
            ]"
            @click.stop.prevent="onItemClick(item)"
          />
        </div>
      </template>
    </ui3n-menu>
  </div>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .loginSelector {
    position: relative;
    width: 100%;

    .label {
      display: block;
      position: relative;
      font-size: var(--font-12);
      font-weight: 600;
      line-height: var(--font-16);
      color: var(--color-text-control-primary-default);
      margin-bottom: var(--spacing-xs);
    }

    .menu {
      width: 100%;
      max-width: 100% !important;

      & > div {
        max-width: 100% !important;
      }
    }

    .activator {
      position: relative;
      width: 100%;
    }

    .body {
      position: relative;
      width: 100%;
      max-height: 140px;
      background-color: var(--color-bg-control-secondary-default);
      padding: var(--spacing-xs);
      overflow-y: auto;

      &.empty {
        padding: 0;
      }

      .item {
        display: flex;
        min-height: var(--spacing-l);
        justify-content: flex-start;
        align-items: center;
        padding: var(--spacing-xs) var(--spacing-s);
        font-size: var(--font-14);
        line-height: var(--font-16);
        font-weight: 500;
        color: var(--color-text-control-primary-default);
        border-radius: var(--spacing-xs);
        user-select: none;
        cursor: pointer;
        @include mixins.text-overflow-ellipsis();

        &.itemSelected,
        &:hover {
          background-color: var(--color-bg-control-primary-hover);
          color: var(--color-text-control-accent-default);
        }

        &.itemDisabled {
          opacity: 0.7;
          pointer-events: none;
        }
      }
    }
  }
</style>
