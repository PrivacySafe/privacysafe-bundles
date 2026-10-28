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
  import { Ui3nButton, Ui3nMenu, Ui3nRadio, Ui3nSwitch } from '@v1nt1248/3nclient-lib';
  import { AVAILABLE_THEMES, AVAILABLE_LANGS } from '@/common/constants';
  import { useSettings } from '@/common/composables/useSettings';
  import CustomScrollBar from '@/common/components/custom-scroll-bar.vue';

  const {
    t,
    lang,
    colorTheme,
    changeColorTheme,
    allowShowingDevtool,
    changeAllowShowingDevtool,
    autoUpdate,
    toggleAutoUpdate,
    customLogoSrc,
    addCustomLogo,
    removeCustomLogo,
    autoLogin,
    autoLoginSetupOpened,
    changeAutoLogin,
    wipeDataFromDevice,
  } = useSettings();

  function changeAutoUpdate(value: boolean) {
    toggleAutoUpdate(value);
  }
</script>

<template>
  <div :class="$style.settings">
    <!-- appearance section/block -->
    <custom-scroll-bar>
      <div :class="$style.block">
        <div :class="$style.title">
          {{ t('settings.section.appearance') }}
        </div>

        <div :class="$style.row">
          <h4 :class="$style.label">
            {{ t('settings.label.theme') }}
          </h4>

          <div :class="$style.value">
            <ui3n-menu
              :offset-x="-48"
              :offset-y="4"
              :allow-flip="false"
            >
              <ui3n-button
                type="custom"
                color="var(--color-bg-control-secondary-default)"
                text-color="var(--color-text-button-tritery-default)"
                icon="outline-arrow-drop-down"
                icon-size="16"
                icon-color="var(--color-icon-button-tritery-default)"
                icon-position="right"
              >
                {{ t(AVAILABLE_THEMES[colorTheme].label) }}
              </ui3n-button>

              <template #menu>
                <div
                  v-for="id in ['dark', 'light', 'midnight'] as const"
                  :key="id"
                  :class="[$style.colorThemesItem, colorTheme === id && $style.colorThemesItemSelected]"
                  @click="changeColorTheme(id)"
                >
                  {{ t(AVAILABLE_THEMES[id].label) }}
                </div>
              </template>
            </ui3n-menu>
          </div>
        </div>

        <!-- languages -->
        <div :class="$style.row">
          <h4 :class="$style.label">
            {{ t('settings.label.language') }}
          </h4>

          <div :class="$style.value">
            <ui3n-radio
              size="20"
              :checked-value="AVAILABLE_LANGS.en.value"
              :unchecked-value="AVAILABLE_LANGS.en.value"
              :disabled="true"
              :model-value="lang"
            >
              {{ AVAILABLE_LANGS[lang].label }}
            </ui3n-radio>
          </div>
        </div>

        <!-- custom logo -->
        <div :class="$style.row">
          <h4 :class="$style.label">
            {{ t('settings.label.custom-logo') }}
          </h4>
          <div :class="$style.value">
            <ui3n-button
              v-if="!customLogoSrc"
              type="primary"
              icon="round-plus"
              icon-position="left"
              @click="addCustomLogo"
            >
              {{ t('settings.btn.custom-logo.add-logo') }}
            </ui3n-button>

            <img
              v-if="!!customLogoSrc"
              :src="customLogoSrc"
              alt="logo"
              :class="$style.customLogo"
            />

            <ui3n-button
              v-if="!!customLogoSrc"
              type="secondary"
              icon="outline-delete"
              @click="removeCustomLogo"
            />
          </div>
        </div>
      </div>

      <!-- system section/block -->
      <div :class="$style.block">
        <div :class="$style.title">
          {{ t('settings.system') }}
        </div>

        <!-- autoupdates -->
        <div :class="$style.row">
          <h4 :class="$style.label">
            {{ t('settings.label.autoupdates') }}
          </h4>

          <div :class="$style.value">
            <span
              :class="[$style.pointer, $style.text]"
              @click="changeAutoUpdate(false)"
            >
              {{ t('settings.label.off') }}
            </span>

            <ui3n-switch
              size="16"
              :model-value="autoUpdate"
              @change="toggleAutoUpdate"
            />

            <span
              :class="[$style.pointer, $style.text]"
              @click="changeAutoUpdate(true)"
            >
              {{ t('settings.label.on') }}
            </span>
          </div>
        </div>

        <!-- allow devtool  -->
        <div :class="$style.row">
          <h4 :class="$style.label">
            {{ t('settings.label.showing_devtool') }}
          </h4>

          <div :class="$style.value">
            <span
              :class="[$style.pointer, $style.text]"
              @click="changeAllowShowingDevtool(false)"
            >
              {{ t('settings.label.no') }}
            </span>

            <ui3n-switch
              size="16"
              :model-value="allowShowingDevtool"
              @change="changeAllowShowingDevtool"
            />

            <span
              :class="[$style.pointer, $style.text]"
              @click="changeAllowShowingDevtool(true)"
            >
              {{ t('settings.label.yes') }}
            </span>
          </div>
        </div>

        <!-- autologin -->
        <div :class="$style.row">
          <h4 :class="$style.label">
            {{ t('settings.label.autologin') }}
          </h4>

          <div
            v-if="autoLoginSetupOpened"
            :class="$style.value"
          />

          <div
            v-else
            :class="$style.value"
          >
            <span
              :class="[$style.pointer, $style.text]"
              @click="changeAutoLogin(false)"
            >
              {{ t('settings.label.off') }}
            </span>

            <ui3n-switch
              size="16"
              :model-value="autoLogin"
              @change="changeAutoLogin"
            />

            <span
              :class="[$style.pointer, $style.text]"
              @click="changeAutoLogin(true)"
            >
              {{ t('settings.label.on') }}
            </span>
          </div>
        </div>
      </div>

      <!-- Data section/block -->
      <div :class="$style.block">
        <div :class="$style.title">
          {{ t('system.data_removal.section') }}
        </div>

        <div :class="$style.row">
          <ui3n-button
            type="tertiary"
            @click="wipeDataFromDevice"
          >
            {{ t('system.data_removal.wipe_from_device') }}
          </ui3n-button>
        </div>
      </div>
    </custom-scroll-bar>
  </div>
</template>

<style lang="scss" module>
  .settings {
    position: relative;
    width: 100%;
    height: 100%;
    padding: var(--spacing-m);
    overflow-x: hidden;
    overflow-y: auto;
    background-color: var(--color-bg-block-primary-default);
  }

  .block {
    position: relative;
    width: 100%;
    margin-bottom: var(--spacing-m);
  }

  .title {
    font-size: var(--font-14);
    font-weight: 600;
    line-height: var(--font-20);
    color: var(--color-text-block-primary-default);
    text-transform: capitalize;
    margin-bottom: var(--spacing-s);
  }

  .row {
    display: flex;
    width: 100%;
    height: var(--spacing-l);
    padding: 0 var(--spacing-s);
    justify-content: space-between;
    align-items: center;
  }

  .label {
    font-size: var(--font-12);
    font-weight: 500;
    line-height: var(--font-20);
    color: var(--color-text-control-primary-default);
    text-transform: capitalize;
    margin-bottom: var(--spacing-s);
  }

  .value {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--spacing-s);
  }

  .text {
    font-size: var(--font-12);
    font-weight: 500;
    color: var(--color-text-control-primary-default);
    text-transform: capitalize;
  }

  .colorThemesItem {
    display: flex;
    width: 120px;
    height: var(--spacing-l);
    padding: 0 12px;
    justify-content: flex-start;
    align-items: center;
    font-size: var(--font-13);
    font-weight: 500;
    color: var(--color-text-control-primary-default);

    &:not(.colorThemesItemSelected) {
      cursor: pointer;
    }

    &.colorThemesItemSelected {
      color: var(--color-text-button-secondary-default);
    }

    &:hover {
      background-color: var(--color-bg-control-primary-hover);
    }
  }

  .pointer {
    cursor: pointer;
  }

  .customLogo {
    max-height: var(--spacing-l);
  }
</style>
