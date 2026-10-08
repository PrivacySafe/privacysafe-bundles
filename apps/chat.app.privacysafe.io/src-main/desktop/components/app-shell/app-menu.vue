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
<!--
 The avatar menu, on a button of its own rather than on the avatar.
 Deliberately the same shape as the ones in the Inbox and Contacts apps: a
 privacysafe app's menu should not be a different thing on every window the user
 opens.
-->
<script lang="ts" setup>
  import { Ui3nButton, Ui3nIcon, Ui3nMenu } from '@v1nt1248/3nclient-lib';
  import { useAppMenuItems } from '@main/common/composables/useAppMenu';
  import type { AppMenuAction } from '~/app.types';

  const emits = defineEmits<{
    (event: 'action', value: AppMenuAction): void;
  }>();

  const menuItems = useAppMenuItems();
</script>

<template>
  <ui3n-menu
    position-strategy="fixed"
    :offset-y="4"
    :content-border-radius="16"
  >
    <ui3n-button
      type="icon"
      color="var(--color-bg-block-primary-default)"
      icon="round-more-vert"
      icon-size="24"
      icon-color="var(--color-icon-control-secondary-default)"
      :class="$style.menuBtn"
    />

    <template #menu>
      <div :class="$style.menu">
        <div
          v-for="(item, index) in menuItems"
          :key="item.id"
          :class="[
            $style.menuItem,
            index === 0 && $style.first,
            index === menuItems.length - 1 && $style.last,
          ]"
          @click="emits('action', item.id)"
        >
          <ui3n-icon
            :icon="item.icon"
            color="var(--color-icon-control-primary-default)"
            :class="$style.icon"
          />

          <span>{{ item.label }}</span>
        </div>
      </div>
    </template>
  </ui3n-menu>
</template>

<style lang="scss" module>
  .menuBtn {
    &:hover {
      div {
        color: var(--color-text-control-accent-default);
      }
    }
  }

  // No elevation(): the shadow comes from ._ui3nMenuContent itself, and a
  // second one on the panel inside it reads as two stacked cards.
  .menu {
    position: relative;
    min-width: 190px;
    padding: 2px;
    background-color: var(--color-bg-control-secondary-default);
    border-radius: var(--spacing-m);
  }

  // No fixed width: the old menu was cut to the one word "Exit", which would
  // clip "Create a backup" to about a third of it.
  .menuItem {
    position: relative;
    width: 100%;
    height: var(--spacing-l);
    padding: 0 var(--spacing-s);
    font-size: var(--font-14);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    white-space: nowrap;
    cursor: pointer;

    &.first {
      border-top-left-radius: var(--spacing-m);
      border-top-right-radius: var(--spacing-m);
    }

    &.last {
      border-bottom-left-radius: var(--spacing-m);
      border-bottom-right-radius: var(--spacing-m);
    }

    &:hover {
      background-color: var(--color-bg-control-primary-hover);
      color: var(--color-text-control-accent-default);

      & > div {
        color: var(--color-text-control-accent-default);
        animation: bounce-once 0.4s ease-in-out forwards;
      }
    }
  }

  @keyframes bounce-once {
    0% {
      transform: scale(1);
    }

    50% {
      transform: scale(1.25);
    }

    100% {
      transform: scale(1);
    }
  }
</style>
