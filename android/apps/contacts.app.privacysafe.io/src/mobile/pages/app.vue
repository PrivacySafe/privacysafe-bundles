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
  import { onBeforeMount, onBeforeUnmount, ref, watch } from 'vue';
  import {
    Ui3nButton,
    Ui3nProgressCircular,
    Ui3nProgressLinear,
    Ui3nDialogProvider,
    Ui3nIcon,
  } from '@v1nt1248/3nclient-lib';
  import { useAppView } from '@main/common/composables/use-app-view';
  import AppMenu from '@main/mobile/components/app-menu.vue';

  const {
    t,
    route,
    router,
    user,
    appVersion,
    connectivityStatusText,
    syncStatusText,
    persistentWarning,
    globalLoading,
    isSyncRunning,
    runMenuAction,
    doBeforeMount,
    doBeforeUnmount,
  } = useAppView();

  const isMenuOpen = ref(false);

  async function toggleMenu() {
    isMenuOpen.value = !isMenuOpen.value;
    await router.push({ query: { isMenuOpen: isMenuOpen.value ? 'on' : 'off' } });
  }

  onBeforeMount(doBeforeMount);
  onBeforeUnmount(doBeforeUnmount);

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
  <div
    data-tutorial="main"
    :class="$style.app"
  >
    <transition name="slide-fade">
      <div
        v-if="isMenuOpen"
        :class="$style.menu"
      >
        <app-menu
          :user="user"
          @close="isMenuOpen = false"
          @action="runMenuAction"
        />
      </div>
    </transition>

    <div :class="[$style.body, isMenuOpen && $style.bodyDisabled]">
      <div :class="$style.toolbar">
        <transition>
          <ui3n-button
            data-tutorial="appMenuBtn"
            type="icon"
            size="large"
            :color="isMenuOpen ? 'transparent' : 'var(--color-bg-block-primary-default)'"
            :icon="isMenuOpen ? 'round-close' : 'round-menu'"
            :icon-color="
              isMenuOpen ? 'var(--color-icon-block-secondary-default)' : 'var(--color-icon-block-primary-default)'
            "
            icon-size="32"
            @click="toggleMenu"
          />
        </transition>

        <div :class="$style.item">
          <span :class="$style.itemName">
            {{ t('app.title') }}
          </span>

          <span :class="$style.version">
            {{ appVersion }}
          </span>
        </div>

        <div :class="$style.info">
          <div :class="$style.status">
            <span>{{ t('app.status.label') }}</span>

            <b :class="connectivityStatusText.includes(t('app.status.connected.online')) && $style.ok" />
          </div>

          <div :class="$style.status">
            <span>{{ t('app.sync.status') }}</span>

            <b :class="!syncStatusText.includes(t('app.status.unsynced')) && $style.ok" />
          </div>
        </div>

        <div
          v-if="isSyncRunning"
          :class="$style.processing"
        >
          <ui3n-progress-linear indeterminate />
        </div>
      </div>

      <div
        v-if="persistentWarning"
        :class="$style.warning"
      >
        <ui3n-icon
          icon="round-warning"
          width="16"
          height="16"
          color="var(--warning-content-default)"
        />
        <span>{{ persistentWarning }}</span>
      </div>

      <div :class="[$style.content, persistentWarning && $style.contentUnderWarning]">
        <router-view v-slot="{ Component }">
          <transition>
            <component :is="Component" />
          </transition>
        </router-view>

        <div
          v-if="globalLoading"
          :class="$style.loader"
        >
          <ui3n-progress-circular
            indeterminate
            size="100"
            width="4"
          />
        </div>
      </div>
    </div>

    <div id="notification" />
    <ui3n-dialog-provider />
  </div>
</template>

<style lang="scss" module>
  .app {
    --main-toolbar-height: 64px;
    --warning-bar-height: 40px;

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
        background-color: var(--files-darker);
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

  .toolbar {
    position: relative;
    width: 100%;
    height: var(--main-toolbar-height);
    padding: 0 var(--spacing-m) 0 var(--spacing-s);
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--color-border-block-primary-default);
    background-color: var(--color-bg-block-primary-default);
  }

  .processing {
    position: absolute;
    left: 0;
    width: 100%;
    bottom: 0;
  }

  .item {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
    user-select: none;
  }

  .itemName {
    font-size: var(--font-18);
    font-weight: 700;
    color: var(--color-text-block-primary-default);
  }

  .version {
    font-size: var(--font-12);
    line-height: var(--font-18);
    color: var(--color-text-block-secondary-default);
  }

  .warning {
    position: relative;
    width: 100%;
    min-height: var(--warning-bar-height);
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: var(--spacing-xs) var(--spacing-s);
    background-color: var(--warning-fill-default);
    color: var(--warning-content-default);
    font-size: var(--font-12);
    line-height: var(--font-16);
    user-select: none;
  }

  .content {
    position: relative;
    width: 100%;
    height: calc(100% - var(--main-toolbar-height) - 1px);
  }

  /* The height above is a calc, so the banner has to be subtracted from it. */
  .contentUnderWarning {
    height: calc(100% - var(--main-toolbar-height) - 1px - var(--warning-bar-height));
  }

  .loader {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .info {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-end;
    color: var(--color-text-control-primary-default);
    line-height: 1.4;
    user-select: none;
  }

  .status {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    column-gap: var(--spacing-s);
    font-size: var(--font-11);
    font-weight: 500;

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
