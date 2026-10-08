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
  import { onBeforeMount, ref } from 'vue';
  import { Ui3nDialogProvider, Ui3nButton, Ui3nProgressLinear, Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import { useAppView } from '@main/common/composables/useAppView';
  import { useAppStore } from '@main/common/store/app.store';
  import OrientationNotice from '@main/common/components/app-shell/orientation-notice.vue';
  import AppMenu from '@main/mobile/components/app-shell/app-menu.vue';
  import BackendUnreachable from '@main/common/components/app-shell/backend-unreachable.vue';

  const {
    t,
    me,
    isOnline,
    connectivityStatusText,
    commonLoading,
    runMenuAction,
    isSyncing,
    syncPending,
    syncPhase,
    syncStalled,
    syncStatusText,
    showSyncStatus,
  } = useAppView();
  const { setMobileMode } = useAppStore();

  const isMenuOpen = ref(false);

  function toggleMenu() {
    isMenuOpen.value = !isMenuOpen.value;
  }

  onBeforeMount(() => {
    setMobileMode(true);
  });
</script>

<template>
  <section :class="$style.app">
    <transition name="slide-fade">
      <div
        v-if="isMenuOpen"
        :class="$style.menu"
      >
        <app-menu
          :user="me"
          @close="isMenuOpen = false"
          @action="runMenuAction"
        />
      </div>
    </transition>

    <div :class="[$style.body, isMenuOpen && $style.bodyDisabled]">
      <div :class="$style.toolbar">
        <ui3n-button
          type="icon"
          size="large"
          :color="isMenuOpen ? 'transparent' : 'var(--color-bg-block-primary-default)'"
          :icon="isMenuOpen ? 'round-close' : 'round-menu'"
          :icon-color="
            isMenuOpen ? 'var(--color-icon-block-secondary-default)' : 'var(--color-icon-block-primary-default)'
          "
          icon-size="32"
          :class="$style.menuBtn"
          @click="toggleMenu"
        />

        <div :class="$style.title">
          {{ t('app.title') }}
        </div>

        <div
          :class="$style.status"
          :title="t(connectivityStatusText)"
        >
          <span>{{ t('app.status.label') }}</span>

          <b :class="isOnline && $style.ok" />
        </div>

        <!-- Out of the flow: its wording is long enough to squeeze the toolbar. -->
        <div
          v-if="showSyncStatus"
          :class="[$style.syncStatus, syncStalled && $style.syncStalled]"
          :title="syncStalled ? t('app.sync.stalledTooltip') : t(`app.sync.tooltip.${syncPhase}`)"
        >
          {{ t(syncStatusText, { count: syncPending }) }}
        </div>

        <div
          v-if="isSyncing"
          :class="$style.syncProgress"
        >
          <ui3n-progress-linear
            :height="2"
            indeterminate
            bg-color="transparent"
          />
        </div>
      </div>

      <div :class="$style.content">
        <router-view v-slot="{ Component }">
          <transition>
            <component :is="Component" />
          </transition>
        </router-view>
      </div>
    </div>

    <!--
      Outside .body on purpose: notices, dialogs and the orientation prompt must
      not be greyed out or made inert by the drawer's overlay.
    -->
    <div id="notification" />

    <backend-unreachable />

    <ui3n-dialog-provider />

    <orientation-notice />

    <div
      v-if="commonLoading"
      :class="$style.loading"
    >
      <ui3n-progress-circular
        indeterminate
        size="120"
        width="6"
      />
    </div>
  </section>
</template>

<style lang="scss" module>
  .app {
    --main-toolbar-height: 64px;

    position: fixed;
    inset: 0;
    display: flex;
    justify-content: flex-start;
    align-items: stretch;
    overflow: hidden;
  }

  /* The full-screen loader of an action that blocks the app, the same as the
     desktop window's: over everything, including the drawer. */
  .loading {
    position: fixed;
    inset: 0;
    z-index: 4000;
    display: flex;
    justify-content: center;
    align-items: center;
    backdrop-filter: blur(4px);
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
    padding: 0 var(--spacing-m) 0 var(--spacing-s);
    height: var(--main-toolbar-height);
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: var(--color-bg-block-primary-default);
    border-bottom: 1px solid var(--color-border-block-primary-default);

    .menuBtn {
      --ui3n-button-height: 40px !important;
      --ui3n-button-icon-large: 40px !important;
    }
  }

  /*
    Spans the toolbar just above the progress bar, out of the flow: in the flow
    its wording ("Catching up on messages…") pushed the title off centre.
  */
  .syncStatus {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 2px;
    padding: 0 var(--spacing-s);
    text-align: center;
    pointer-events: none;
    font-size: var(--font-12);
    font-weight: 500;
    line-height: var(--font-14);
    color: var(--color-text-control-secondary-default);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .syncStalled {
    color: var(--warning-content-default);
  }

  /* The connectivity light, spelled as in the contacts and inbox apps. */
  .status {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    column-gap: var(--spacing-s);
    font-size: var(--font-11);
    font-weight: 500;
    line-height: 1.4;
    color: var(--color-text-control-primary-default);
    user-select: none;

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

  .syncProgress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1;
  }

  .title {
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: var(--font-16);
    font-weight: 700;
    color: var(--color-text-block-primary-default);
    column-gap: var(--spacing-s);
  }

  /*
    `relative` with a calc height, not `fixed`: a fixed child escapes the
    stacking context of .bodyDisabled, so the router's viewport would stay lit
    and clickable behind the drawer's overlay.
  */
  .content {
    position: relative;
    width: 100%;
    height: calc(100% - var(--main-toolbar-height) - 1px);
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
    align-content: center;
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
