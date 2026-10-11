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
  import { onMounted, ref } from 'vue';
  import {
    Ui3nDialogProvider,
    Ui3nProgressCircular,
    Ui3nProgressLinear,
    Ui3nResize,
    type Ui3nResizeCbArg,
  } from '@v1nt1248/3nclient-lib';
  import prLogo from '@common/assets/images/privacysafe-logo-new.svg';
  import ContactIcon from '@common/components/contact-icon/contact-icon.vue';
  import AppMenu from '@desktop/components/app-menu/app-menu.vue';
  import { useAppPage } from '@common/composables/useAppPage';

  const vUi3nResize = Ui3nResize;

  const {
    $bus,
    appVersion,
    me,
    customLogoSrc,
    commonLoading,
    startupStatusText,
    connectivityStatusText,
    isSyncVisible,
    isSyncing,
    syncText,
    t,
    setAppWindowSize,
    runMenuAction,
  } = useAppPage();

  const appElement = ref<Element | null>(null);

  function onResize(value: Ui3nResizeCbArg) {
    setAppWindowSize({ width: value.width, height: value.contentHeight });
    $bus.$emitter.emit('resize-app', void 0);
  }

  async function openDashboard() {
    await w3n.shell!.openDashboard!();
  }

  onMounted(() => {
    if (appElement.value) {
      const { width, height } = appElement.value.getBoundingClientRect();
      setAppWindowSize({ width, height });
    }
  });
</script>

<template>
  <div
    ref="appElement"
    v-ui3n-resize="onResize"
    :class="$style.app"
  >
    <div :class="$style.toolbar">
      <div :class="$style.toolbarTitle">
        <img
          :src="customLogoSrc ? customLogoSrc : prLogo"
          alt="logo"
          :class="$style.toolbarLogo"
          @click="openDashboard"
        >
        <div :class="$style.delimiter">
          /
        </div>
        <div :class="$style.info">
          {{ t('app.title') }}
          <div :class="$style.version">
            v {{ appVersion }}
          </div>
        </div>
      </div>

      <div
        v-if="isSyncVisible"
        :class="$style.sync"
      >
        {{ syncText }}
      </div>

      <div :class="$style.user">
        <div :class="$style.userInfo">
          <span :class="$style.mail">
            {{ me }}
          </span>
          <span :class="$style.connection">
            {{ t('app.status.label') }}:
            <span :class="connectivityStatusText === 'app.status.connected.online' && $style.connectivity">
              {{ t(connectivityStatusText) }}
            </span>
          </span>
        </div>

        <contact-icon
          :name="me"
          :size="36"
          :readonly="true"
        />

        <app-menu @action="runMenuAction" />
      </div>

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

    <div id="notification" />

    <ui3n-dialog-provider />
  </div>
</template>

<style lang="scss" module>
  .app {
    --main-toolbar-height: calc(var(--spacing-s) * 9);

    position: fixed;
    inset: 0;
  }

  .toolbar {
    position: relative;
    width: 100%;
    height: var(--main-toolbar-height);
    padding: 0 var(--spacing-m);
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }

  .sync {
    font-size: var(--font-12);
    line-height: var(--font-16);
    color: var(--color-text-control-secondary-default);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 var(--spacing-m);
    // A flex item's min-width is `auto`, so without this the line refuses to
    // shrink below its text and pushes the blocks beside it instead of
    // ellipsising on a narrow window.
    min-width: 0;
  }

  .syncBar {
    position: absolute !important;
    left: 0;
    right: 0;
    bottom: -1px;
  }

  .toolbarTitle {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-m);
  }

  .toolbarLogo {
    position: relative;
    height: var(--spacing-m);
    cursor: pointer;
  }

  .delimiter {
    font-size: 20px;
    font-weight: 500;
    line-height: 28px;
    color: var(--color-text-control-accent-default);
  }

  .info {
    position: relative;
    width: max-content;
    font-size: var(--font-16);
    font-weight: 500;
    line-height: 28px;
    color: var(--color-text-control-primary-default);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .version {
    color: var(--color-text-control-secondary-default);
    line-height: 28px;
  }

  .user {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    column-gap: var(--spacing-xs);
  }

  .userInfo {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-end;
    margin-right: var(--spacing-m);

    span:not(.connectivity) {
      color: var(--color-text-control-primary-default);
      line-height: 1.4;
    }
  }

  .mail {
    font-size: var(--font-14);
    font-weight: 600;
  }

  .connection {
    font-size: var(--font-12);
    font-weight: 500;
  }

  .connectivity {
    color: var(--success-content-default);
  }

  .content {
    position: fixed;
    left: 0;
    right: 0;
    top: calc(var(--main-toolbar-height) + 1px);
    bottom: 0;
  }

  // Full-screen and blocking: besides the start-up, this covers the window for
  // an action that must not be interrupted, such as Force-refresh data. Without
  // covering the toolbar the menu behind it would still be clickable.
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
