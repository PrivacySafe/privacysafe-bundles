><!--
 Copyright (C) 2026 3NSoft Inc.

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
<script setup lang="ts">
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton, Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import type { ProcessInfo } from '@/common/store/apps/processes';
  import type { PlatformInfo } from '@/common/store/apps/platform';
  import psIcon from '@/common/assets/images/platform-icon.png';
  import AppIcon from '@/common/components/app-icon.vue';

  const props = defineProps<{
    platform?: PlatformInfo;
    canBePlatformUpdated?: boolean;
    needToRestartPlatformAfterUpdate?: boolean;
    downloadPlatformProc?: ProcessInfo;
    appStoreMode?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: 'update' | 'restart'): void;
  }>();

  const { t } = useI18n();

  function doAction() {
    if (props.needToRestartPlatformAfterUpdate) {
      emits('action', 'restart');
      return;
    }

    if (props.canBePlatformUpdated) {
      emits('action', 'update');
    }
  }
</script>

<template>
  <div :class="[$style.platformInfo, appStoreMode && $style.appStoreMode]">
    <div :class="$style.block">
      <app-icon :icon-url="psIcon" />

      <div :class="$style.name">
        <span>{{ t('platform.title') }}</span>

        <template v-if="appStoreMode && platform?.version">
          <span :class="$style.version">
            {{ t('app.version', { version: platform.version }) }}
          </span>

          <span :class="$style.description">
            {{ t('platform.description') }}
          </span>
        </template>
      </div>
    </div>

    <ui3n-button
      v-if="!appStoreMode"
      type="custom"
      :color="
        downloadPlatformProc ? 'var(--color-bg-button-primary-pressed)' : 'var(--color-bg-button-primary-default)'
      "
      :text-color="
        downloadPlatformProc
          ? 'var(--color-bg-button-primary-pressed)'
          : 'var(--color-text-button-primary-default)'
      "
      @click="doAction"
    >
      {{ needToRestartPlatformAfterUpdate ? t('platform.action_restart') : t('app.action.update') }}

      <div
        v-if="downloadPlatformProc"
        :class="$style.inProcess"
      >
        <ui3n-progress-circular
          size="36"
          with-text
          bg-color="var(--color-bg-button-primary-pressed)"
          color="var(--color-icon-button-primary-default)"
          :value="downloadPlatformProc.progressValue"
        />
      </div>
    </ui3n-button>
  </div>
</template>

<style lang="scss" module>
  @use '@/common/assets/styles/_mixins' as mixins;

  .platformInfo {
    --item-height: 56px;

    position: relative;
    width: 100%;
    min-height: var(--item-height);
    height: var(--item-height);
    padding: 0 var(--spacing-s) 0 var(--spacing-m);
    border-radius: var(--spacing-s);
    background-color: var(--color-bg-control-secondary-default);
    display: flex;
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-s);
    user-select: none;

    button {
      min-height: var(--spacing-xl);
      min-width: 124px;
      padding: 0 12px;
    }

    &.appStoreMode {
      --item-height: 64px;

      .block {
        width: 100%;
      }

      .name {
        width: calc(100% - 48px);
      }
    }
  }

  .block {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .name {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    row-gap: 2px;
    font-size: var(--font-16);
    font-weight: 500;
    line-height: var(--font-18);
    color: var(--color-text-block-primary-default);

    .version {
      font-size: var(--font-10);
      font-weight: 500;
      line-height: var(--font-12);
      color: var(--color-text-block-secondary-default);
    }

    .description {
      display: inline-block;
      font-size: var(--font-10);
      font-weight: 500;
      line-height: var(--font-12);
      color: var(--color-text-block-primary-default);
      @include mixins.text-overflow-ellipsis();
    }
  }

  .inProcess {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;

    div {
      color: var(--color-text-button-primary-default) !important;
    }
  }
</style>
