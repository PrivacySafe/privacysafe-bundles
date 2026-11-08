<!--
 Copyright (C) 2020 - 2025 3NSoft Inc.

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
  import {
    Ui3nDialogProvider,
    Ui3nProgressLinear,
    Ui3nProgressCircular,
    Ui3nResize as vUi3nResize,
  } from '@v1nt1248/3nclient-lib';
  import prLogo from '@main/common/assets/images/privacysafe-logo-new.svg';
  import { useAppView } from '@main/common/composables/useAppView';
  import ContactIcon from '@main/common/components/contacts/contact-icon.vue';
  import AppMenu from '@main/desktop/components/app-shell/app-menu.vue';
  import BackendUnreachable from '@main/common/components/app-shell/backend-unreachable.vue';

  const {
    commonLoading,
    me,
    customLogoSrc,
    appVersion,
    connectivityStatusText,
    isSyncing,
    syncPending,
    syncPhase,
    syncStalled,
    syncStatusText,
    showSyncStatus,
    setAppWindowSize,
    openDashboard,
    runMenuAction,
    t,
  } = useAppView();
</script>

<template>
  <div
    v-ui3n-resize="setAppWindowSize"
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
        v-if="showSyncStatus"
        :class="[$style.syncStatus, syncStalled && $style.syncStalled]"
        :title="syncStalled ? t('app.sync.stalledTooltip') : t(`app.sync.tooltip.${syncPhase}`)"
      >
        {{ t(syncStatusText, { count: syncPending }) }}
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

    <div id="notification" />

    <backend-unreachable />

    <ui3n-dialog-provider />

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
    color: var(--color-text-control-accent-default);
    padding-bottom: 2px;
  }

  .info {
    position: relative;
    width: max-content;
    font-size: var(--font-16);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    gap: var(--spacing-s);
    padding-bottom: calc(var(--spacing-xs) / 2);
  }

  .version {
    font-size: var(--font-16);
    font-weight: 500;
    color: var(--color-text-control-secondary-default);
    line-height: var(--font-16);
  }

  .syncStatus {
    flex: 0 1 auto;
    min-width: 0;
    padding: 0 var(--spacing-m);
    font-size: var(--font-12);
    font-weight: 500;
    color: var(--color-text-control-secondary-default);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .syncStalled {
    color: var(--warning-content-default);
  }

  .syncProgress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1;
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

  .loading {
    position: fixed;
    inset: 0;
    z-index: 4000;
    display: flex;
    justify-content: center;
    align-items: center;
    backdrop-filter: blur(4px);
  }
</style>
