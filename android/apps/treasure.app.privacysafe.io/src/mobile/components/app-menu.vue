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
  import { useRoute, useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { Ui3nButton, Ui3nMobileMenu, Ui3nMobileMenuItem } from '@v1nt1248/3nclient-lib';
  import { useRecordStore } from '@/common/stores/record.store';
  import type { TreasureGroup } from '@shared/@types';
  import ContactIcon from '@/common/components/ui/contact-icon.vue';
  import CustomScrollBar from '@/common/components/custom-scroll-bar.vue';

  defineProps<{
    isMenuOpen: boolean;
    user: string;
    connectivityStatus: string;
  }>();
  const emits = defineEmits<{
    (event: 'update:modelValue', value: boolean): void;
    (event: 'action', value: 'exit' | 'make-backup' | 'upload-backup'): void;
  }>();

  const route = useRoute();
  const router = useRouter();
  const { t } = useI18n();

  const menuItems = [
    { id: 'make-backup', icon: 'outline-file-download', label: t('app.menu.makeBackup') },
    { id: 'upload-backup', icon: 'outline-file-upload', label: t('app.menu.uploadBackup') },
    { id: 'exit', icon: 'round-logout', label: t('app.menu.exit') },
  ];

  const recordStore = useRecordStore();
  const { sortedGroupsAll } = storeToRefs(recordStore);

  const selectedGroup = computed(() => (route.query?.group as string) || 'all');

  async function selectGroup(group: TreasureGroup) {
    await router.push({ query: { group: group.id } });
    emits('update:modelValue', false);
  }

  function onMenuItemClick(id: string) {
    emits('update:modelValue', false);

    switch (id) {
      case 'exit':
        emits('action', 'exit');
        break;

      case 'make-backup':
        emits('action', 'make-backup');
        break;

      case 'upload-backup':
        emits('action', 'upload-backup');
        break;

      // no-default
    }
  }
</script>

<template>
  <ui3n-mobile-menu
    :model-value="isMenuOpen"
    width="260px"
    with-blur
    @update:model-value="emits('update:modelValue', $event)"
  >
    <template #header>
      <div :class="$style.menuHeader">
        <contact-icon
          :size="36"
          :name="user"
          readonly
        />

        <div :class="$style.info">
          <div :class="$style.user">
            {{ user }}
          </div>

          <div :class="$style.status">
            <span>{{ t('app.status.label') }}</span>

            <b :class="connectivityStatus === 'online' && $style.ok" />
          </div>
        </div>
      </div>
    </template>

    <template #menuBody>
      <div :class="$style.body">
        <custom-scroll-bar>
          <ui3n-mobile-menu-item
            v-for="item in sortedGroupsAll"
            :key="item.id"
            :item="item"
            :is-active="item.id === selectedGroup"
            :class="$style.item"
            @select-item="selectGroup"
          />
        </custom-scroll-bar>
      </div>
    </template>

    <template #footer>
      <div :class="$style.actions">
        <ui3n-button
          v-for="item in menuItems"
          :key="item.id"
          type="outline"
          size="large"
          :icon="item.icon"
          icon-position="left"
          block
          @click="() => onMenuItemClick(item.id)"
        >
          {{ item.label }}
        </ui3n-button>
      </div>
    </template>
  </ui3n-mobile-menu>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

  .menuHeader {
    display: flex;
    width: 100%;
    height: 64px;
    padding: 0 var(--spacing-s);
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .info {
    position: relative;
    width: calc(100% - 44px);
  }

  .user {
    font-size: var(--font-14);
    font-weight: 700;
    line-height: var(--font-18);
    @include mixins.text-overflow-ellipsis();
  }

  .status {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
    font-size: var(--font-12);
    font-weight: 500;
    line-height: var(--font-16);

    b {
      position: relative;
      width: 12px;
      min-width: 12px;
      height: 12px;
      min-height: 12px;
      border-radius: 50%;
      background-color: var(--warning-content-default);
    }

    .ok {
      background-color: var(--success-content-default);
    }
  }

  .body {
    position: relative;
    height: 100%;
    padding: var(--spacing-s);

    .item {
      width: calc(100% - var(--spacing-s));
      margin-bottom: var(--spacing-xs);
    }
  }

  .actions {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: var(--spacing-s) var(--spacing-s) var(--spacing-m) var(--spacing-s);
    justify-content: flex-end;
    align-items: stretch;
    row-gap: var(--spacing-s);
  }
</style>
