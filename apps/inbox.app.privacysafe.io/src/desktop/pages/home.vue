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
  import { inject } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useRouter, useRoute } from 'vue-router';
  import { storeToRefs } from 'pinia';
  import get from 'lodash/get';
  import size from 'lodash/size';
  import { VUEBUS_KEY, VueBusPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import { Ui3nBadge, Ui3nButton, Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { useFoldersStore, useMessagesStore } from '@common/store';
  import type { AppGlobalEvents, MailFolder, PreparedMessageData } from '@common/types';
  import { SYSTEM_FOLDERS } from '@common/constants';

  const $bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const { t } = useI18n();

  const route = useRoute();
  const router = useRouter();

  const { systemFolders } = storeToRefs(useFoldersStore());
  const { messagesByFolders } = storeToRefs(useMessagesStore());

  function getBadgeText(folder: MailFolder): number {
    if (folder.id === SYSTEM_FOLDERS.outbox || folder.id === SYSTEM_FOLDERS.draft) {
      return size(get(messagesByFolders.value, [folder.id, 'data'], []));
    }

    return get(messagesByFolders.value, [folder.id, 'unread'], 0);
  }

  async function goToFolder(path: string) {
    await router.push(path);
  }

  function createNewMsg() {
    $bus.$emitter.emit('run-create-message', { data: {} as PreparedMessageData });
  }
</script>

<template>
  <section :class="$style.home">
    <div :class="$style.list">
      <div :class="$style.action">
        <ui3n-button
          icon="round-plus"
          icon-size="16"
          icon-color="var(--color-icon-button-primary-default)"
          icon-position="left"
          @click="createNewMsg"
        >
          {{ t('app.new.mail') }}
        </ui3n-button>
      </div>

      <div :class="$style.systemFolders">
        <div
          v-for="systemFolder in systemFolders"
          :key="systemFolder.id"
          :class="[$style.systemFolder, systemFolder.path === route.name && $style.systemFolderSelected]"
          @click="goToFolder(systemFolder.path)"
        >
          <ui3n-icon
            :class="$style.folderIcon"
            :icon="systemFolder.icon || 'round-folder'"
            :color="systemFolder.iconColor || 'var(--color-icon-control-secondary-default)'"
          />

          <span :class="$style.folderName">{{ systemFolder.name }}</span>

          <ui3n-badge
            v-if="getBadgeText(systemFolder)"
            :value="getBadgeText(systemFolder)"
            :class="$style.systemFolderBadge"
          />
        </div>
      </div>
    </div>

    <div :class="$style.body">
      <router-view v-slot="{ Component }">
        <component
          :is="Component"
          v-if="Component"
        />
      </router-view>
    </div>
  </section>
</template>

<style lang="scss" module>
  .home {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: flex-start;
    align-items: stretch;
  }

  .list {
    position: relative;
    width: calc(var(--column-size) * 2);
    border-right: 1px solid var(--color-border-block-primary-default);
    padding: var(--spacing-s);
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
  }

  .body {
    position: relative;
    width: calc(100% - calc(var(--column-size) * 2) - 1px);
    display: flex;
    justify-content: flex-start;
    align-items: stretch;
  }

  .action {
    position: relative;
    padding: var(--spacing-s);
  }

  .systemFolders {
    position: relative;
    width: 100%;
    padding: var(--spacing-s) 0;
  }

  .systemFolder {
    position: relative;
    display: flex;
    width: 100%;
    height: 36px;
    border-radius: var(--spacing-s);
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-s);
    padding: 0 var(--spacing-s) 0 var(--spacing-l);
    cursor: pointer;
    margin-bottom: var(--spacing-xs);

    .folderIcon {
      position: absolute;
      left: var(--spacing-s);
      top: 10px;
    }

    .folderName {
      font-size: var(--font-13);
      line-height: var(--font-16);
      color: var(--color-text-control-primary-default);
    }

    .systemFolderBadge {
      min-width: 20px;
    }

    &.systemFolderSelected,
    &:hover {
      background-color: var(--color-bg-control-primary-hover);

      & > div {
        color: var(--color-icon-control-accent-default) !important;
      }
    }
  }
</style>
