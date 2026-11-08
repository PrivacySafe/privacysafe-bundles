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
  import { Ui3nButton, Ui3nIcon, Ui3nMenu } from '@v1nt1248/3nclient-lib';

  const emits = defineEmits<{
    (event: 'action', value: 'exit' | 'make-backup' | 'upload-backup'): void;
  }>();

  const { t } = useI18n();

  const menuItems = [
    { id: 'make-backup', icon: 'outline-file-download', label: t('app.menu.makeBackup') },
    { id: 'upload-backup', icon: 'outline-file-upload', label: t('app.menu.uploadBackup') },
    { id: 'exit', icon: 'round-logout', label: t('app.menu.exit') },
  ];

  function onMenuItemClick(id: string) {
    switch (id) {
      case 'exit':
        emits('action', 'exit');
        break;

      case 'make-backup':
        emits('action','make-backup');
        break;

      case 'upload-backup':
        emits('action','upload-backup');
        break;

      // no-default
    }
  }
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
          :class="[$style.menuItem, index === 0 && $style.first, index === menuItems.length - 1 && $style.last]"
          @click="() => onMenuItemClick(item.id)"
        >
          <ui3n-icon
            :icon="item.icon"
            :class="$style.icon"
          />

          <span>{{ item.label }}</span>
        </div>
      </div>
    </template>
  </ui3n-menu>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .menuBtn {
    &:hover {
      div {
        color: var(--color-text-control-accent-default);
      }
    }
  }

  .menu {
    --menu-item-height: 32px;

    position: relative;
    min-width: 150px;
    padding: 2px;
    background-color: var(--color-bg-control-secondary-default);
    border-radius: var(--spacing-m);

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
  }

  @keyframes bounce-once {
    0% {
      transform: scale(1);
    }

    50% {
      transform: scale(1.25); /* Пик увеличения */
    }

    100% {
      transform: scale(1); /* Финал анимации */
    }
  }
</style>
