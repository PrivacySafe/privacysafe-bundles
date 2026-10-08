<!--
 Copyright (C) 2024 - 2025 3NSoft Inc.

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
  import { useI18n } from 'vue-i18n';
  import {
    Ui3nDialogProvider,
    Ui3nButton,
    Ui3nIcon,
    Ui3nMenu,
    Ui3nResize,
    Ui3nRipple,
    Ui3nProgressCircular,
    Ui3nProgressLinear,
  } from '@v1nt1248/3nclient-lib';
  import prLogo from '@/assets/images/privacysafe-logo-new.svg';
  import { useAppView } from '@/composables/useAppView';
  import ContactIcon from '@/components/contacts/contact-icon.vue';

  const vUi3nResize = Ui3nResize;
  const vUi3nRipple = Ui3nRipple;

  const { t } = useI18n();

  const {
    appElement,
    appVersion,
    me,
    connectivityStatus,
    connectivityStatusText,
    customLogoSrc,
    commonLoading,
    isFillingUpSyncQueue,
    onResize,
    openAppSettings,
    appExit,
  } = useAppView();

  async function openDashboard() {
    await w3n.shell!.openDashboard!();
  }
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

      <div :class="$style.user">
        <div :class="$style.userInfo">
          <span :class="$style.mail">
            {{ me }}
          </span>
          <span :class="$style.connection">
            {{ t('app.status.label') }}:
            <span :class="connectivityStatusText === 'app.status.online' && $style.connectivity">
              {{ t(connectivityStatusText) }}
            </span>
          </span>
        </div>

        <div
          v-ui3n-ripple
          :class="$style.icon"
        >
          <contact-icon
            :name="me || ''"
            :size="36"
            :readonly="true"
          />
        </div>

        <ui3n-menu
          position-strategy="fixed"
          :offset-y="4"
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
                :class="$style.menuItem"
                @click="openAppSettings"
              >
                <ui3n-icon icon="outline-settings" />
                {{ t('app.settings.title') }}
              </div>

              <div
                :class="$style.menuItem"
                @click="appExit"
              >
                <ui3n-icon icon="round-logout" />
                {{ t('app.exit') }}
              </div>
            </div>
          </template>
        </ui3n-menu>
      </div>

      <div
        v-if="isFillingUpSyncQueue && connectivityStatus === 'online'"
        :class="$style.syncInfo"
      >
        <div :class="$style.syncInfoText">
          {{ t('app.sync.start') }}
        </div>
        <ui3n-progress-linear indeterminate />
      </div>
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
      </div>
    </div>

    <div id="notification" />

    <ui3n-dialog-provider />
  </div>
</template>

<style lang="scss" module>
  @use '@/assets/styles/_mixins' as mixins;

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
    cursor: pointer;
    height: var(--spacing-m);
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
    column-gap: var(--spacing-s);

    button {
      min-width: 36px !important;
      width: 36px !important;
      height: 36px;
    }
  }

  .menuBtn {
    &:hover {
      div {
        color: var(--color-text-control-accent-default);
      }
    }
  }

  .userInfo {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-end;

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

  .icon {
    position: relative;
    cursor: pointer;
    overflow: hidden;
    border-radius: 50%;
  }

  .menu {
    position: relative;
    padding: 2px 0;
    background-color: var(--color-bg-control-secondary-default);
    width: max-content;
    border-radius: var(--spacing-xs);
    @include mixins.elevation(1);
  }

  .menuItem {
    position: relative;
    width: 100px;
    height: var(--spacing-l);
    padding: 0 var(--spacing-s);
    font-size: var(--font-14);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-xs);
    cursor: pointer;

    &:hover {
      background-color: var(--color-bg-control-primary-hover);
      color: var(--color-text-control-accent-default);

      div {
        color: var(--color-text-control-accent-default);
      }
    }
  }

  .content {
    position: fixed;
    left: 0;
    right: 0;
    top: calc(var(--main-toolbar-height) + 1px);
    bottom: 0;
  }

  .loader {
    position: absolute;
    inset: 0;
    z-index: 10;
    background-color: var(--black-12);
    display: flex;
    justify-content: center;
    align-items: center;
    pointer-events: none;
  }

  .syncInfo {
    position: absolute;
    left: 0;
    width: 100%;
    bottom: 0;

    .syncInfoText {
      position: relative;
      width: 100%;
      text-align: center;
      margin-bottom: var(--spacing-xs);
      font-size: var(--font-13);
      font-weight: 500;
      color: var(--color-text-control-accent-default);
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
