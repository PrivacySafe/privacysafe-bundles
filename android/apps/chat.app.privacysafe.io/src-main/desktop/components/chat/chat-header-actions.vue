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
  import { computed } from 'vue';
  import size from 'lodash/size';
  import { Ui3nButton, Ui3nMenu, Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { useChatHeaderActions } from '@main/common/composables/useChatHeaderActions';
  import type { ChatListItemView } from '~/chat.types.ts';

  const props = defineProps<{
    chat: ChatListItemView;
    chatWithCall?: boolean;
    disabled?: boolean;
    allOthersBlocked?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'select:action', value: string): void;
  }>();

  const propsValue = computed(() => props);

  const { t, isMenuOpen, availableMenuItems, selectAction, isMenuItemDisabled, isSubItemSelected } =
    useChatHeaderActions(propsValue, emits);
</script>

<template>
  <ui3n-menu
    v-model="isMenuOpen"
    :offset-y="4"
    :close-on-click="false"
    :content-border-radius="16"
    :disabled="disabled"
    :class="$style.menu"
  >
    <ui3n-button
      type="custom"
      color="var(--color-bg-button-tritery-default)"
      text-color="var(--color-text-button-tritery-default)"
      icon="outline-arrow-drop-down"
      icon-size="16"
      icon-color="var(--color-icon-button-tertiary-default)"
      icon-position="right"
      :disabled="disabled"
    >
      {{ t('chat.header.btn.actions') }}
    </ui3n-button>

    <template #menu>
      <div :class="$style.chatHeaderActionsMenu">
        <div
          v-for="(item, index) in availableMenuItems"
          :key="item.action"
          :class="[
            $style.chatHeaderActionsMenuItem,
            item.margin && $style.margin,
            item.isAccent && $style.chatHeaderActionsMenuItemAccent,
            item.subMenu && $style.withSubMenu,
            isMenuItemDisabled(item) && $style.disabled,
            index === 0 && $style.itemFirst,
            index === size(availableMenuItems) - 1 && $style.itemLast,
          ]"
          v-on="isMenuItemDisabled(item) || item.subMenu ? {} : { click: () => selectAction(item) }"
        >
          <ui3n-icon
            :icon="item.icon"
            size="16"
            :color="item.isAccent ? 'var(--warning-content-default)' : 'var(--color-icon-control-primary-default)'"
            :class="$style.icon"
          />

          {{ t(item.text) }}

          <ui3n-icon
            v-if="item.subMenu"
            icon="round-keyboard-arrow-right"
            size="16"
            color="var(--color-icon-control-primary-default)"
            :class="$style.icon"
          />

          <div
            v-if="item.subMenu"
            :class="$style.subMenu"
          >
            <div
              v-for="(subItem, ind) in item.subMenu"
              :key="subItem.action"
              :class="[
                $style.chatHeaderActionsMenuItem,
                subItem.margin && $style.margin,
                subItem.isAccent && $style.chatHeaderActionsMenuItemAccent,
                isSubItemSelected(subItem) && $style.isSelected,
                isMenuItemDisabled(subItem) && $style.disabled,
                ind === 0 && $style.itemFirst,
                ind === size(item.subMenu) - 1 && $style.itemLast,
              ]"
              v-on="isMenuItemDisabled(subItem) || subItem.subMenu ? {} : { click: () => selectAction(subItem) }"
            >
              {{ t(subItem.text) }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </ui3n-menu>
</template>

<style lang="scss" module>
  @keyframes scale {
    0% {
      transform: scale(1);
    }

    50% {
      transform: scale(0.75);
    }

    100% {
      transform: scale(1);
    }
  }

  .menu {
    div:last-child {
      overflow: visible !important;
    }
  }

  .chatHeaderActionsMenu {
    --chat-header-menu-width: max-content;
    --chat-header-menu-item-height: var(--spacing-l);

    position: relative;
    width: var(--chat-header-menu-width);
    background-color: var(--color-bg-control-secondary-default);
    border-radius: var(--spacing-m);
    padding: var(--spacing-xs);
  }

  .chatHeaderActionsMenuItem {
    position: relative;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    padding: 0 var(--spacing-s);
    height: var(--chat-header-menu-item-height);
    font-size: 13px;
    font-weight: 400;
    line-height: var(--font-16);
    color: var(--color-text-control-primary-default);
    border-radius: var(--spacing-xs);
    cursor: pointer;

    &.itemFirst {
      border-radius: var(--spacing-m) var(--spacing-m) var(--spacing-xs) var(--spacing-xs);
    }

    &.itemLast {
      border-radius: var(--spacing-xs) var(--spacing-xs) var(--spacing-m) var(--spacing-m);
    }

    &:hover {
      background-color: var(--color-bg-control-primary-hover);
      color: var(--color-text-control-accent-default);

      .icon {
        animation: scale 0.4s ease-in-out;
      }

      :global(.ui3n-icon) {
        color: var(--color-icon-control-accent-hover);
      }
    }

    &.withSubMenu:hover {
      .subMenu {
        display: block;
      }
    }
  }

  .chatHeaderActionsMenuItemAccent {
    color: var(--warning-content-default);

    &:hover {
      background-color: var(--warning-fill-hover);
      color: var(--warning-content-default);

      :global(.ui3n-icon) {
        color: var(--warning-content-default);
      }
    }
  }

  .isSelected {
    background-color: var(--color-bg-control-primary-hover);
  }

  .margin {
    margin-top: var(--spacing-xs);
  }

  .disabled {
    pointer-events: none;
    opacity: 0.5;
    cursor: default;
  }

  .subMenu {
    display: none;
    position: absolute;
    padding: var(--spacing-xs);
    background-color: var(--color-bg-control-secondary-default);
    border-radius: var(--spacing-m);
    width: 100px;
    top: 0;
    left: -100px;
    min-height: calc(var(--chat-header-menu-item-height) + var(--spacing-xs) * 2);
    box-shadow:
      0 0 2px 0 var(--shadow-key-1),
      0 2px 5px 0 var(--shadow-key-2);

    &:hover {
      display: block;
    }
  }
</style>
