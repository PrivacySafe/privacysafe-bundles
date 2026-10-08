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
  import { computed, inject, ref } from 'vue';
  import { storeToRefs } from 'pinia';
  import { useRoute } from 'vue-router';
  import size from 'lodash/size';
  import get from 'lodash/get';
  import { VUEBUS_KEY, VueBusPlugin } from '@v1nt1248/3nclient-lib/plugins';
  import {
    Ui3nBadge,
    Ui3nButton,
    Ui3nDialogProvider,
    Ui3nProgressCircular,
    Ui3nProgressLinear,
  } from '@v1nt1248/3nclient-lib';
  import { useMessagesStore } from '@common/store';
  import { useAppPage } from '@common/composables/useAppPage';
  import { MAIL_FOLDERS_DEFAULT, SYSTEM_FOLDERS } from '@common/constants';
  import type { AppGlobalEvents } from '@common/types';
  import AppMenu from '@mobile/components/app-menu/app-menu.vue';
  import { getRandomId } from '@v1nt1248/3nclient-lib/utils';

  const $bus = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;

  const route = useRoute();
  const {
    appVersion,
    me,
    connectivityStatusText,
    commonLoading,
    startupStatusText,
    isSyncing,
    runMenuAction,
  } = useAppPage(true);
  const { messagesByFolders } = storeToRefs(useMessagesStore());

  const isMenuOpen = ref(false);

  const currentFolder = computed(() => {
    const { name, params } = route;
    if (name !== 'folder') {
      return { name: '', id: null };
    }

    const { folderId } = params as { folderId: string };
    const folder = MAIL_FOLDERS_DEFAULT.find(mf => mf.id === folderId);

    return folder || { name: '', id: null };
  });

  const currentFolderBadgeText = computed(() => {
    if (!currentFolder.value.id) {
      return '';
    }

    if (currentFolder.value.id === SYSTEM_FOLDERS.outbox || currentFolder.value.id === SYSTEM_FOLDERS.draft) {
      return size(get(messagesByFolders.value, [currentFolder.value.id, 'data'], []));
    }

    return get(messagesByFolders.value, [currentFolder.value.id, 'unread'], 0);
  });

  const isCreateBtnShow = computed(() => route.name === 'folder');

  function toggleMenu() {
    isMenuOpen.value = !isMenuOpen.value;
  }

  function createNewMessage() {
    $bus.$emitter.emit('run-create-message', {
      data: {
        id: getRandomId(32),
        threadId: getRandomId(32),
        recipients: [],
        subject: '',
        attachmentsInfo: [],
        htmlTxtBody: '',
      },
    });
  }
</script>

<template>
  <div :class="$style.app">
    <transition name="slide-fade">
      <div
        v-if="isMenuOpen"
        :class="$style.menu"
      >
        <app-menu
          :app-version="appVersion"
          :user="me"
          :connectivity-status-text="connectivityStatusText"
          @close="isMenuOpen = false"
          @action="runMenuAction"
        />
      </div>
    </transition>

    <div :class="[$style.body, isMenuOpen && $style.bodyDisabled]">
      <div :class="$style.toolbar">
        <transition>
          <ui3n-button
            type="icon"
            size="large"
            :color="isMenuOpen ? 'transparent' : 'var(--color-bg-block-primary-default)'"
            :icon="isMenuOpen ? 'round-close' : 'round-menu'"
            icon-color="var(--color-icon-block-primary-default)"
            icon-size="32"
            :disabled="commonLoading"
            @click="toggleMenu"
          />
        </transition>

        <div :class="$style.folder">
          <span :class="$style.folderName">{{ currentFolder.name }}</span>

          <ui3n-badge
            v-if="currentFolderBadgeText"
            :class="$style.folderMsgsCount"
            :value="currentFolderBadgeText"
          />
        </div>

        <span :class="$style.toolbarCapCell" />

        <!-- The bar alone here: the toolbar has no room for a line of text. -->
        <ui3n-progress-linear
          v-if="isSyncing"
          indeterminate
          :height="2"
          :class="$style.syncBar"
        />
      </div>

      <div :class="$style.content">
        <router-view v-slot="{ Component }">
          <transition>
            <component :is="Component" />
          </transition>
        </router-view>

        <ui3n-button
          v-if="isCreateBtnShow"
          type="icon"
          size="large"
          color="var(--color-bg-button-primary-default)"
          icon="round-plus"
          icon-color="var(--color-icon-button-primary-default)"
          icon-size="32"
          :disabled="commonLoading"
          :class="$style.createBtn"
          @click="createNewMessage"
        />

        <div
          v-if="commonLoading"
          :class="$style.loader"
        >
          <ui3n-progress-circular
            indeterminate
            size="100"
          />

          <div
            v-if="startupStatusText"
            :class="$style.loaderText"
          >
            {{ startupStatusText }}
          </div>
        </div>
      </div>
    </div>

    <div id="notification" />

    <ui3n-dialog-provider />
  </div>
</template>

<style lang="scss" module>
  @use '@common/assets/styles/mixins' as mixins;

  .app {
    --main-toolbar-height: 64px;

    position: fixed;
    inset: 0;
    display: flex;
    justify-content: flex-start;
    align-items: stretch;
    overflow: hidden;
  }

  .menu {
    position: relative;
    min-width: 80%;
    width: 80%;
    height: 100%;
    z-index: 1;
  }

  .body {
    position: relative;
    min-width: 100%;
    width: 100%;
    height: 100%;

    &.bodyDisabled {
      background-color: var(--files-darker);

      .toolbar {
        border-bottom: none !important;
      }

      .content {
        pointer-events: none;

        &::after {
          position: absolute;
          content: '';
          inset: 0;
          z-index: 5;
          background-color: var(--files-darker);
        }
      }
    }
  }

  // !important for the same reason as on the desktop toolbar: the component
  // sets `position: relative` on its own root at equal specificity, and the
  // library's stylesheet is loaded after this one.
  .syncBar {
    position: absolute !important;
    left: 0;
    right: 0;
    bottom: -1px;
  }

  .toolbar {
    position: relative;
    width: 100%;
    height: var(--main-toolbar-height);
    padding: 0 var(--spacing-xl) 0 var(--spacing-s);
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--color-border-block-primary-default);

    .toolbarCapCell {
      display: block;
      position: relative;
      width: 48px;
    }
  }

  .folder {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);

    .folderMsgsCount {
      min-width: 20px;
    }
  }

  .folderName {
    font-size: var(--font-16);
    font-weight: 700;
    color: var(--color-text-block-primary-default);
  }

  .content {
    position: relative;
    width: 100%;
    height: calc(100% - var(--main-toolbar-height) - 1px);
  }

  .createBtn {
    position: absolute !important;
    bottom: var(--spacing-m);
    right: var(--spacing-m);
    z-index: 2;
  }

  // Full-screen and blocking: besides the start-up, this covers the window for
  // an action that must not be interrupted, such as Force-refresh data. Without
  // covering the drawer/toolbar the menu behind it would still be clickable.
  .loader {
    position: fixed;
    inset: 0;
    z-index: 4000;
    background-color: var(--black-12);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    row-gap: var(--spacing-m);
  }

  .loaderText {
    padding: 0 var(--spacing-m);
    font-size: var(--font-13);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
    text-align: center;
  }

  #notification {
    position: fixed;
    bottom: var(--spacing-xs);
    left: var(--spacing-m);
    right: var(--spacing-m);
    z-index: 5000;
    height: auto;
    display: flex;
    justify-content: center;
    align-content: flex-end;
  }
</style>

<style lang="scss">
  .slide-fade-enter-active {
    transition: all 0.2s ease-out;
  }

  .slide-fade-leave-active {
    transition: all 0.2s cubic-bezier(1, 0.5, 0.8, 1);
  }

  .slide-fade-enter-from,
  .slide-fade-leave-to {
    opacity: 0;
  }
</style>
