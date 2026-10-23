<!--
 Copyright (C) 2024 3NSoft Inc.

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
  import { computed, ref } from 'vue';
  import {
    Ui3nButton,
    Ui3nProgressCircular,
    Ui3nResize as vUi3nResize,
    type Ui3nResizeCbArg,
  } from '@v1nt1248/3nclient-lib';
  import { useAppLauncher } from '@/common/composables/useAppLauncher';
  import type { AppLaunchers } from '@/common/types';
  import AppIcon from '@/common/components/app-icon.vue';
  import AppStatus from '@/common/components/app-status.vue';

  const props = defineProps<{
    launchers: AppLaunchers;
  }>();

  const appIconSize = ref(0);
  const appNameFontSize = ref(16);
  const appVersionFontSize = ref(10);

  const propsValue = computed(() => props.launchers);
  const appNameFontSizeCss = computed(() => `${appNameFontSize.value}px`);
  const appVersionFontSizeCss = computed(() => `${appVersionFontSize.value}px`);

  const { t, needToCloseOldVersion, canBeLaunched, appProcessToDisplay, launchDefault, closeOldVersionApps } =
    useAppLauncher(propsValue);

  function onElementResize(data: Ui3nResizeCbArg) {
    const { width } = data;
    appIconSize.value = Math.floor(width / 3);
    appNameFontSize.value = Math.floor(width / 9);
    appVersionFontSize.value = Math.floor(width / 12);
  }
</script>

<template>
  <div
    v-ui3n-resize="onElementResize"
    :class="$style.appLauncher"
  >
    <app-icon
      :icon-bytes="launchers.iconBytes"
      :size="`${appIconSize}`"
    />

    <div :class="$style.info">
      <div :class="$style.name">
        {{ launchers.name }}
      </div>

      <div :class="$style.version">v {{ launchers.version }}</div>
    </div>

    <div :class="$style.action">
      <ui3n-button
        v-if="launchers.defaultLauncher && canBeLaunched"
        type="secondary"
        :class="$style.btn"
        @click="launchDefault"
      >
        {{ t('app.action.open') }}
      </ui3n-button>

      <ui3n-button
        v-if="launchers.defaultLauncher && needToCloseOldVersion"
        :class="$style.btn"
        @click="closeOldVersionApps"
      >
        {{ t('app.action.close_old_version') }}
      </ui3n-button>
    </div>

    <app-status
      :tags="launchers.tags"
      :class="$style.status"
      :font-size="appVersionFontSize"
    />

    <div
      v-if="!!appProcessToDisplay"
      :class="$style.progressOverlay"
    >
      <ui3n-progress-circular
        size="40"
        with-text
        :value="appProcessToDisplay.progressValue"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
  .appLauncher {
    --app-name-font-size: v-bind(appNameFontSizeCss);
    --app-ver-font-size: v-bind(appVersionFontSizeCss);

    position: relative;
    min-width: 0;
    width: 100%;
    aspect-ratio: 1 / 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    padding: 10%;
    background-color: var(--color-bg-control-secondary-default);
    border-radius: var(--spacing-m);
  }

  .info {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    row-gap: var(--spacing-s);
  }

  .name {
    font-size: var(--app-name-font-size);
    font-weight: 500;
    line-height: 1;
    color: var(--color-text-block-primary-default);
  }

  .version {
    font-size: var(--app-ver-font-size);
    font-weight: 500;
    line-height: 1;
    color: var(--color-text-block-secondary-default);
  }

  .action {
    display: flex;
    justify-content: center;
    align-items: center;
    column-gap: var(--spacing-s);
    width: 100%;
    height: var(--spacing-l);
    padding-top: var(--spacing-s);

    .btn {
      text-transform: capitalize;
    }
  }

  .status {
    order: -1;
    align-self: stretch;
    text-align: right;
    flex-shrink: 0;
    margin-bottom: var(--spacing-xs);
  }

  .progressOverlay {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: var(--spacing-m);
    background-color: var(--shadow-key-1);
  }
</style>
