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
  import { onBeforeMount, onBeforeUnmount } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nDialogProvider, Ui3nIcon, Ui3nProgressCircular, Ui3nProgressLinear } from '@v1nt1248/3nclient-lib';
  import prLogo from '@main/common/assets/images/privacysafe-logo-new.svg';
  import { useAppView } from '@main/common/composables/use-app-view';
  import ContactIcon from '@main/common/components/contact-icon.vue';
  import AppMenu from '@main/desktop/components/app-menu.vue';

  const { t } = useI18n();

  const {
    user,
    customLogoSrc,
    appElement,
    appVersion,
    connectivityStatusText,
    isSyncRunning,
    syncStatusText,
    persistentWarning,
    globalLoading,
    runMenuAction,
    doBeforeMount,
    doBeforeUnmount,
  } = useAppView();

  async function openDashboard() {
    await w3n.shell!.openDashboard!();
  }

  onBeforeMount(doBeforeMount);
  onBeforeUnmount(doBeforeUnmount);
</script>

<template>
  <div
    ref="appElement"
    data-tutorial="main"
    :class="$style.app"
  >
    <div :class="$style.toolbar">
      <div :class="$style.toolbarTitle">
        <img
          :src="customLogoSrc ? customLogoSrc : prLogo"
          alt="logo"
          :class="$style.toolbarLogo"
          @click="openDashboard"
        />
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

      <div :class="$style.user">
        <div :class="$style.userInfo">
          <span :class="$style.mail">
            {{ user }}
          </span>

          <div :class="$style.status">
            <span>{{ t('app.status.label') }}</span>

            <b :class="connectivityStatusText.includes(t('app.status.connected.online')) && $style.ok">
              {{ connectivityStatusText }}
            </b>
          </div>

          <div :class="$style.status">
            <span>{{ t('app.sync.status') }}</span>

            <b :class="!syncStatusText.includes(t('app.status.unsynced')) && $style.ok">
              {{ syncStatusText }}
            </b>
          </div>
        </div>

        <contact-icon
          :name="user"
          :size="36"
          :readonly="true"
        />

        <app-menu @action="runMenuAction" />
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

    <ui3n-dialog-provider />
  </div>
</template>

<style lang="scss" module>
  @use '@main/common/assets/styles/_mixins' as mixins;

  .app {
    --main-toolbar-height: 72px;
    --warning-bar-height: 32px;

    position: fixed;
    inset: 0;
    background-size: cover;
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
    user-select: none;
  }

  .toolbarTitle {
    display: flex;
    justify-content: flex-start;
    align-items: center;
  }

  .toolbarLogo {
    position: relative;
    top: -2px;
    margin-right: var(--spacing-m);
    height: var(--spacing-m);
    cursor: pointer;
  }

  .processing {
    position: absolute;
    left: 0;
    width: 100%;
    bottom: 0;
  }

  .delimiter {
    font-size: 20px;
    font-weight: 500;
    color: var(--color-text-control-accent-default);
    margin-right: var(--spacing-m);
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
    color: var(--color-text-control-primary-default);
    line-height: 1.4;

    .ok {
      color: var(--success-content-default);
    }
  }

  .mail {
    font-size: var(--font-14);
    font-weight: 600;
  }

  .status {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    column-gap: var(--spacing-s);
    font-size: var(--font-12);
    font-weight: 500;

    b {
      position: relative;
      width: 68px;
      text-transform: uppercase;
      text-align: right;
    }
  }

  /*
 * Sits between the toolbar and the content, but has to be positioned rather
 * than flow: .content below is fixed, so it would not be pushed down.
 */
  .warning {
    position: fixed;
    left: 0;
    right: 0;
    top: calc(var(--main-toolbar-height) + 1px);
    height: var(--warning-bar-height);
    display: flex;
    align-items: center;
    gap: var(--spacing-xs);
    padding: 0 var(--spacing-m);
    background-color: var(--warning-fill-default);
    color: var(--warning-content-default);
    font-size: var(--font-12);
    line-height: var(--font-16);
    user-select: none;
  }

  .content {
    position: fixed;
    left: 0;
    right: 0;
    top: calc(var(--main-toolbar-height) + 1px);
    bottom: 0;
  }

  .contentUnderWarning {
    top: calc(var(--main-toolbar-height) + 1px + var(--warning-bar-height));
  }

  .loader {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }
</style>
