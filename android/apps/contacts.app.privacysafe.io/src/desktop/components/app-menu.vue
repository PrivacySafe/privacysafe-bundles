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
<script lang="ts" setup>
  import { computed, ref, onMounted, watch } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton, Ui3nIcon, Ui3nMenu } from '@v1nt1248/3nclient-lib';
  import { useTutorialStore } from '@main/common/store/tutorial.store';
  import type { AppMenuAction } from '@main/types';

  const emits = defineEmits<{
    (event: 'action', value: AppMenuAction): void;
  }>();

  const { t } = useI18n();
  const route = useRoute();
  const router = useRouter();

  const { checkAndRunSteps } = useTutorialStore();

  const isMenuOpen = ref(false);

  const menuItems = computed<{ id: AppMenuAction; icon: string; label: string }[]>(() => [
    { id: 'tutorial', icon: 'book-open-blank-variant', label: t('app.menu.tutorial') },
    { id: 'make-backup', icon: 'outline-file-download', label: t('app.menu.makeBackup') },
    { id: 'upload-backup', icon: 'outline-file-upload', label: t('app.menu.uploadBackup') },
    { id: 'exit', icon: 'round-logout', label: t('app.menu.exit') },
  ]);

  async function onUpdate() {
    const newMenuOpenValue = !isMenuOpen.value;
    await router.push({ query: { isMenuOpen: newMenuOpenValue ? 'on' : 'off' } });
  }

  onMounted(() => {
    void checkAndRunSteps();
  });

  watch(
    () => route.query.isMenuOpen,
    val => {
      if ((val === 'on' && !isMenuOpen.value) || ((val === 'off' || !val) && isMenuOpen.value)) {
        isMenuOpen.value = val === 'on';
      }
    },
    {
      immediate: true,
    },
  );
</script>

<template>
  <ui3n-menu
    :model-value="isMenuOpen"
    position-strategy="fixed"
    :offset-y="4"
    :content-border-radius="16"
    @update:model-value="onUpdate"
  >
    <ui3n-button
      data-tutorial="appMenuBtn"
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
          :data-tutorial="item.id"
          :class="[$style.menuItem, index === 0 && $style.first, index === menuItems.length - 1 && $style.last]"
          @click="emits('action', item.id)"
        >
          <ui3n-icon
            :icon="item.icon"
            color="var(--color-icon-control-primary-default)"
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

  .menu {
    position: relative;
    min-width: 190px;
    padding: 2px;
    background-color: var(--color-bg-control-secondary-default);
    border-radius: var(--spacing-m);
  }

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
      transform: scale(1.25); /* Пик увеличения */
    }

    100% {
      transform: scale(1); /* Финал анимации */
    }
  }
</style>
