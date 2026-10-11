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
  import { Ui3nButton, Ui3nMenu, Ui3nRadio, Ui3nSwitch, Ui3nProgressLinear } from '@v1nt1248/3nclient-lib';
  import { AVAILABLE_THEMES, AVAILABLE_LANGS } from '@/common/constants';
  import { useSettings } from '@/common/composables/useSettings';
  import CustomScrollBar from '@/common/components/custom-scroll-bar.vue';

  const emits = defineEmits<{
    (ev: 'close'): void;
  }>();

  const { t } = useI18n();

  const {
    colorTheme,
    changeColorTheme,
    lang,
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
</script>

<template>
  <section :class="$style.appSettings">
    <div :class="$style.toolbar">
      {{ t('settings.title') }}
      <ui3n-button
        :class="$style.close"
        type="icon"
        color="transparent"
        icon="round-close"
        icon-size="24"
        icon-color="var(--color-icon-button-secondary-default)"
        @click="emits('close')"
      />
    </div>

    <div :class="$style.body">
      <custom-scroll-bar>
        <!-- appearance section/block -->
        <div :class="$style.block">
          <div :class="$style.blockHeader">
            {{ t('settings.section.appearance') }}
          </div>

          <!-- theme -->
          <div :class="$style.rowBody">
            <div :class="$style.rowBodyLabel">
              {{ t('settings.label.theme') }}
            </div>

            <div :class="$style.rowBodyValue">
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
          <div :class="$style.rowBody">
            <div :class="$style.rowBodyLabel">
              {{ t('settings.label.language') }}
            </div>

            <div :class="$style.rowBodyValue">
              <ui3n-radio
                size="16"
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
          <div :class="$style.rowBody">
            <div :class="$style.rowBodyLabel">
              {{ t('settings.label.custom-logo') }}
            </div>

            <div :class="$style.rowBodyValue">
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
          <div :class="$style.blockHeader">
            {{ t('settings.system') }}
          </div>

          <!-- autoupdates -->
          <div :class="$style.rowBody">
            <div :class="$style.rowBodyLabel">
              {{ t('settings.label.autoupdates') }}
            </div>

            <div :class="$style.rowBodyValue">
              <span :class="$style.rowBodyText">{{ t('settings.label.off') }}</span>

              <ui3n-switch
                size="16"
                :model-value="autoUpdate"
                @change="toggleAutoUpdate"
              />

              <span :class="$style.rowBodyText">{{ t('settings.label.on') }}</span>
            </div>
          </div>

          <!-- showing devtool -->
          <div :class="$style.rowBody">
            <div :class="$style.rowBodyLabel">
              {{ t('settings.label.showing_devtool') }}
            </div>

            <div :class="$style.rowBodyValue">
              <span :class="$style.rowBodyText">{{ t('settings.label.no') }}</span>

              <ui3n-switch
                size="16"
                :model-value="allowShowingDevtool"
                @change="changeAllowShowingDevtool"
              />

              <span :class="$style.rowBodyText">{{ t('settings.label.yes') }}</span>
            </div>
          </div>

          <!-- autologin -->
          <div :class="$style.rowBody">
            <div :class="$style.rowBodyLabel">
              {{ t('settings.label.autologin') }}
            </div>

            <div
              v-if="autoLoginSetupOpened"
              :class="$style.rowBodyValue"
            >
              <ui3n-progress-linear
                :class="$style.loginProgressBar"
                indeterminate
              />
            </div>

            <div
              v-else
              :class="$style.rowBodyValue"
            >
              <span :class="$style.rowBodyText">{{ t('settings.label.off') }}</span>

              <ui3n-switch
                size="16"
                :model-value="autoLogin"
                @change="changeAutoLogin"
              />

              <span :class="$style.rowBodyText">{{ t('settings.label.on') }}</span>
            </div>
          </div>
        </div>

        <!-- Data section/block -->
        <div :class="$style.block">
          <div :class="$style.blockHeader">
            {{ t('system.data_removal.section') }}
          </div>
          <div :class="$style.rowBody">
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
  </section>
</template>

<style lang="scss" module>
  .appSettings {
    --app-settings-toolbar-height: var(--spacing-xxl);

    position: relative;
    width: 100%;
    height: 100%;
  }

  .toolbar {
    position: relative;
    width: 100%;
    height: var(--app-settings-toolbar-height);
    display: flex;
    justify-content: center;
    align-items: center;
    border-top: 1px solid var(--color-border-block-primary-default);
    border-bottom: 1px solid var(--color-border-block-primary-default);
    font-size: var(--font-14);
    font-weight: 500;
    line-height: var(--font-20);
    color: var(--color-text-control-primary-default);
    text-transform: capitalize;
  }

  .close {
    position: absolute;
    left: var(--spacing-ml);
    top: var(--spacing-s);
  }

  .body {
    position: relative;
    width: 100%;
    height: calc(100% - var(--app-settings-toolbar-height));
    overflow-y: auto;
    padding: var(--spacing-m);
  }

  .block {
    position: relative;
    width: 100%;
    margin-bottom: var(--spacing-m);
  }

  .blockHeader {
    display: flex;
    width: 100%;
    height: var(--spacing-ml);
    justify-content: center;
    align-items: center;
    font-size: var(--font-12);
    font-weight: 500;
    line-height: var(--font-20);
    color: var(--color-text-block-primary-default);
    text-transform: capitalize;
  }

  .rowBody {
    display: flex;
    width: 100%;
    height: var(--spacing-xl);
    padding: 0 var(--spacing-m);
    justify-content: space-between;
    align-items: center;
  }

  .rowBodyLabel {
    font-size: var(--font-14);
    font-weight: 500;
    line-height: var(--font-20);
    color: var(--color-text-control-primary-default);
    text-transform: capitalize;
  }

  .rowBodyValue {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--spacing-s);
  }

  .rowBodyText {
    min-width: var(--spacing-ml);
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

  .customLogo {
    max-height: var(--spacing-l);
  }

  .loginProgressBar {
    width: 6em;
  }
</style>
