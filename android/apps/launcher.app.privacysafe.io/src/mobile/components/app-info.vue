<!--
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
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nButton, Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import type { AppInfo } from '@/common/types';
  import type { ProcessInfo } from '@/common/store/apps/processes';
  import { updateVersionIn } from '@/common/utils/versions';
  import AppIcon from '@/common/components/app-icon.vue';
  import AppStatus from '@/common/components/app-status.vue';

  const props = defineProps<{
    appInfo?: AppInfo;
    canBeUpdated?: boolean;
    needToCloseOldVersion?: boolean;
    appProcesses?: ProcessInfo[];
    appStoreMode?: boolean;
  }>();
  const emits = defineEmits<{
    (event: 'action', value: { action: 'update' | 'close:old'; app: AppInfo }): void;
  }>();

  const { t } = useI18n();

  const downloadOrUnzipProc = computed(() =>
    props.appProcesses?.find(({ procType }) => procType === 'downloading' || procType === 'unzipping'),
  );

  const versionToInstall = computed(() => props.appInfo?.versions?.latest);
  const versionInUpdate = computed(() => (props.appInfo ? updateVersionIn(props.appInfo) : undefined));
  const canBeInstalled = computed(
    () => versionToInstall.value && !props.appProcesses && !props.appInfo?.versions?.current,
  );
  const appDisplayedVersion = computed(() => {
    if (canBeInstalled.value) {
      return t('version.to-install', { install: versionToInstall.value! });
    }

    return versionInUpdate.value
      ? t('version.to-update', {
          current: props.appInfo!.versions!.current!,
          update: versionInUpdate.value!.version,
        })
      : t('app.version', { version: props.appInfo!.versions!.current! });
  });

  function doAction() {
    if (props.needToCloseOldVersion) {
      emits('action', { action: 'close:old', app: props.appInfo! });
      return;
    }

    if (props.canBeUpdated) {
      emits('action', { action: 'update', app: props.appInfo! });
    }
  }
</script>

<template>
  <div :class="[$style.appInfo, appStoreMode && $style.appStoreMode]">
    <div :class="$style.block">
      <app-icon
        v-if="appInfo?.iconBytes"
        :class="$style.icon"
        :icon-bytes="appInfo.iconBytes"
      />

      <div :class="$style.name">
        <span :class="$style.title">{{ appInfo?.name }}</span>

        <app-status :tags="appInfo?.tags" />

        <template v-if="appStoreMode">
          <span :class="$style.version">
            {{ appDisplayedVersion }}
          </span>

          <span :class="$style.description">
            {{ appInfo?.description }}
          </span>
        </template>
      </div>
    </div>

    <ui3n-button
      v-if="!appStoreMode"
      type="custom"
      :color="
        downloadOrUnzipProc ? 'var(--color-bg-button-primary-pressed)' : 'var(--color-bg-button-primary-default)'
      "
      :text-color="
        downloadOrUnzipProc ? 'var(--color-bg-button-primary-pressed)' : 'var(--color-text-button-primary-default)'
      "
      @click="doAction"
    >
      {{ needToCloseOldVersion ? t('app.action.close_old_version') : t('app.action.update') }}

      <div
        v-if="downloadOrUnzipProc"
        :class="$style.inProcess"
      >
        <ui3n-progress-circular
          size="36"
          with-text
          bg-color="var(--color-bg-button-primary-pressed)"
          color="var(--color-icon-button-primary-default)"
          :value="downloadOrUnzipProc.progressValue"
        />
      </div>
    </ui3n-button>
  </div>
</template>

<style lang="scss" module>
  @use '@/common/assets/styles/_mixins' as mixins;

  .appInfo {
    --item-height: 56px;

    position: relative;
    width: 100%;
    min-height: var(--item-height);
    flex-shrink: 0;
    padding: var(--spacing-s) var(--spacing-s) var(--spacing-s) var(--spacing-m);
    border-radius: var(--spacing-s);
    background-color: var(--color-bg-control-secondary-default);
    display: flex;
    justify-content: space-between;
    align-items: center;
    column-gap: var(--spacing-s);
    user-select: none;

    button {
      flex-shrink: 0;
      min-height: var(--spacing-xl);
      min-width: 124px;
      padding: 0 12px;
    }

    &.appStoreMode {
      --item-height: 64px;

      .block {
        width: 100%;
      }
    }
  }

  .block {
    flex: 1;
    min-width: 0;
    display: flex;
    justify-content: flex-start;
    align-items: center;
    column-gap: var(--spacing-s);
  }

  .icon {
    flex-shrink: 0;
  }

  .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    row-gap: 2px;
    font-size: var(--font-16);
    font-weight: 500;
    line-height: var(--font-18);
    color: var(--color-text-block-primary-default);

    .title,
    .version {
      max-width: 100%;
      overflow-wrap: anywhere;
    }

    .version {
      font-size: var(--font-10);
      font-weight: 500;
      line-height: var(--font-12);
      color: var(--color-text-block-secondary-default);
    }

    .description {
      width: 100%;
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
