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
  import { onBeforeMount, onBeforeUnmount, ref } from 'vue';
  import isEmpty from 'lodash/isEmpty';
  import {
    Ui3nButton,
    Ui3nDialogProvider,
    Ui3nMenu,
    Ui3nTabs,
    Ui3nTooltip,
    Ui3nRipple as vUi3nRipple,
  } from '@v1nt1248/3nclient-lib';
  import { useAppPage } from '@/common/composables/useAppPage';
  import prLogo from '@/common/assets/images/privacysafe-logo.svg';
  import { APP_USER_DEFAULT_MENU } from '@/common/constants';
  import ContactIcon from '@/common/components/contact-icon.vue';
  import SystemSettings from '@/desktop/components/system-settings.vue';
  import Applications from '@/desktop/pages/main-tabs/applications.vue';
  import Updates from '@/desktop/pages/main-tabs/updates.vue';

  const mainTabs = [{ label: 'app.tabs.applications' }, { label: 'app.tabs.update' }];

  const {
    t,
    appElement,
    appVersion,
    user,
    openUsers,
    connectivityStatus,
    connectivityStatusText,
    customLogoSrc,
    needPlatformRestartAfterUpdate,
    checkProcIsOn,
    onUserMenuOpen,
    runAction,
    quitAndInstall,
    checkForUpdate,
    doBeforeMount,
    doBeforeUnmount,
    addAppFromFile,
  } = useAppPage();

  const currentTab = ref(0);
  const isSettingsShow = ref(false);

  onBeforeMount(doBeforeMount);
  onBeforeUnmount(doBeforeUnmount);

  function openSystemMap() {
    w3n.shell!.startAppWithParams!(null, 'open-system-map');
  }
</script>

<template>
  <div
    ref="appElement"
    :class="$style.app"
  >
    <div :class="$style.toolbar">
      <div :class="$style.toolbarTitle">
        <img
          :src="customLogoSrc ? customLogoSrc : prLogo"
          alt="logo"
          :class="$style.toolbarLogo"
        />
        <div :class="$style.delimiter">/</div>
        <div :class="$style.info">
          {{ t('app.title') }}
          <div :class="$style.version">
            {{ t('app.version', { version: appVersion }) }}
          </div>
        </div>
      </div>

      <div :class="$style.user">
        <div :class="$style.userInfo">
          <span :class="$style.mail">
            {{ user }}
          </span>

          <span :class="$style.connection">
            {{ t('app.status.label') }}:
            <span :class="connectivityStatusText === 'app.status.online' && $style.connectivity">
              {{ t(connectivityStatusText) }}
            </span>
          </span>
        </div>

        <ui3n-menu
          position-strategy="fixed"
          :offset-y="4"
          :class="$style.menuWrapper"
          @open="onUserMenuOpen"
        >
          <div
            v-ui3n-ripple
            :class="$style.icon"
          >
            <contact-icon
              :name="user"
              :size="36"
              :readonly="true"
            />
          </div>

          <template #menu>
            <div :class="$style.menu">
              <template v-if="!isEmpty(openUsers)">
                <div
                  v-for="u in openUsers"
                  :key="u"
                  :class="[$style.menuItem, u === user && $style.menuItemDisabled]"
                  @click="() => runAction(u)"
                >
                  {{ u }}
                </div>

                <div :class="$style.separator" />
              </template>

              <div
                v-for="item in APP_USER_DEFAULT_MENU"
                :key="item.key"
                :class="$style.menuItem"
                @click="() => runAction(item.key)"
              >
                {{ t(item.label_key) }}
              </div>
            </div>
          </template>
        </ui3n-menu>
      </div>
    </div>

    <div :class="$style.tabsWrapper">
      <ui3n-tabs v-model="currentTab">
        <div
          v-for="(tab, index) in mainTabs"
          :key="index"
          :class="$style.tab"
        >
          {{ t(tab.label) }}
        </div>
      </ui3n-tabs>

      <div :class="$style.btns">
        <ui3n-tooltip
          :content="t('settings.btn.open')"
          position-strategy="fixed"
          placement="top-start"
        >
          <ui3n-button
            :class="$style.settingsBtn"
            type="custom"
            color="var(--color-bg-button-tritery-default)"
            icon="outline-settings"
            icon-size="24"
            icon-color="var(--color-icon-button-tritery-default)"
            @click="isSettingsShow = true"
          />
        </ui3n-tooltip>
      </div>

      <ui3n-button
        v-if="currentTab === 0 && needPlatformRestartAfterUpdate"
        :class="$style.checkUpdates"
        type="tertiary"
        @click="quitAndInstall"
      >
        {{ t('btn.restart-platform') }}
      </ui3n-button>

      <div
        v-if="currentTab === 1"
        :class="$style.btnsOnUpdateTab"
      >
        <ui3n-tooltip
          :content="t('app.add.tooltip')"
          position-strategy="fixed"
          placement="top-end"
        >
          <ui3n-button
            type="custom"
            color="var(--color-bg-button-tritery-default)"
            icon="round-plus"
            icon-size="24"
            icon-color="var(--color-icon-button-tritery-default)"
            :class="$style.updateBtn"
            @click="addAppFromFile"
          />
        </ui3n-tooltip>

        <ui3n-tooltip
          :content="t('system.map.tooltip')"
          position-strategy="fixed"
          placement="top-end"
        >
          <ui3n-button
            type="custom"
            color="var(--color-bg-button-tritery-default)"
            icon="binary-tree"
            icon-size="24"
            icon-color="var(--color-icon-button-tritery-default)"
            :class="$style.updateBtn"
            @click="openSystemMap"
          />
        </ui3n-tooltip>

        <ui3n-tooltip
          :content="checkProcIsOn ? t('btn.checking-for-update') : t('btn.check-update')"
          position-strategy="fixed"
          placement="top-end"
        >
          <ui3n-button
            v-if="connectivityStatus === 'online'"
            type="custom"
            color="var(--color-bg-button-tritery-default)"
            icon="deployed-code-update"
            icon-size="24"
            icon-color="var(--color-icon-button-tritery-default)"
            :disabled="checkProcIsOn"
            :class="$style.updateBtn"
            @click="checkForUpdate"
          />
        </ui3n-tooltip>
      </div>
    </div>

    <div :class="$style.content">
      <transition mode="out-in">
        <applications v-if="currentTab === 0" />
        <updates v-else />
      </transition>
    </div>

    <transition
      name="set"
      mode="out-in"
    >
      <section
        v-if="isSettingsShow"
        :class="[$style.settings, isSettingsShow && $style.settingsOpened]"
      >
        <system-settings @close="isSettingsShow = false" />
      </section>
    </transition>

    <div id="notification" />

    <ui3n-dialog-provider />
  </div>
</template>

<style lang="scss" module>
  @use '@/common/assets/styles/_mixins' as mixins;

  .app {
    --main-toolbar-height: 72px;
    --main-tabs-height: 48px;

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
  }

  .toolbarTitle {
    display: flex;
    justify-content: flex-start;
    align-items: center;
  }

  .toolbarLogo {
    position: relative;
    margin-right: 12px;
    height: var(--spacing-m);
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

  .icon {
    position: relative;
    cursor: pointer;
    overflow: hidden;
    border-radius: 50%;
  }

  .menuWrapper {
    --ui3n-menu-content-border-radius: 6px;
  }

  .menu {
    position: relative;
    background-color: var(--color-bg-control-secondary-default);
    padding: 2px 0;
    width: max-content;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    row-gap: 2px;

    @include mixins.elevation(1);
  }

  .menuItem {
    position: relative;
    min-width: 60px;
    height: var(--spacing-l);
    padding: 0 var(--spacing-s);
    font-size: var(--font-13);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
    display: flex;
    justify-content: flex-start;
    align-items: center;
    cursor: pointer;

    &:hover {
      background-color: var(--color-bg-control-primary-hover);
      color: var(--color-text-control-accent-default);
    }

    &.menuItemDisabled {
      cursor: default;
      pointer-events: none;
      opacity: 0.5;
    }
  }

  .separator {
    position: relative;
    left: var(--spacing-s);
    width: calc(100% - var(--spacing-m));
    height: 1px;
    border-bottom: 1px solid var(--color-border-control-primary-default);
    margin: 2px 0;
  }

  .tabsWrapper {
    display: flex;
    width: 100%;
    height: var(--main-tabs-height);
    padding: 0 var(--spacing-m);
    justify-content: center;
    align-items: center;
    border-bottom: 1px solid var(--color-border-block-primary-default);
  }

  .tab {
    position: relative;
    height: var(--main-tabs-height);
    width: 120px;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: var(--font-14);
    font-weight: 500;
  }

  .btns {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
    position: absolute;
    left: var(--spacing-m);
  }

  .settingsBtn {
    gap: 0 !important;
    padding-left: var(--spacing-s) !important;
  }

  .updateBtn {
    gap: 0 !important;
    padding-left: var(--spacing-s) !important;
  }

  .btnsOnUpdateTab {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
    position: absolute;
    right: var(--spacing-ml);
  }

  .content {
    position: fixed;
    inset: calc(var(--main-toolbar-height) + var(--main-tabs-height) + 1px) 0 0;
    bottom: 0;
  }

  .settings {
    position: absolute;
    z-index: 5;
    width: 100%;
    height: calc(100% - var(--main-toolbar-height));
    background-color: var(--color-bg-block-primary-default);
    top: 100%;
  }

  .settingsOpened {
    top: var(--main-toolbar-height);
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
