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
  import { computed } from 'vue';
  import { Ui3nButton, Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import type { AppInfo } from '@/common/types';
  import { useAppView } from '@/common/composables/useAppView';
  import AppIcon from '@/common/components/app-icon.vue';
  import AppStatus from '@/common/components/app-status.vue';
  import AppMetadata from '@/common/components/app-metadata.vue';
  import AppItemArea from './app-item-area.vue';

  const props = defineProps<{
    appInfo: AppInfo;
  }>();

  const propsValue = computed(() => props.appInfo);

  const {
    t,
    appId,
    canBeInstalled,
    versionToInstall,
    canBeUpdated,
    versionInUpdate,
    needToCloseOldVersion,
    install,
    update,
    closeOldVersionApps,
    installProc,
    downloadOrUnzipProc,
  } = useAppView(propsValue);
</script>

<template>
  <app-item-area>
    <template #main>
      <app-icon :icon-bytes="appInfo.iconBytes" />

      <div :class="$style.content">
        <div :class="$style.name">
          {{ appInfo.name }}
        </div>
        <app-status
          :tags="appInfo.tags"
          :class="$style.status"
        />

        <div :class="$style.version">
          {{
            canBeInstalled
              ? t('version.to-install', { install: versionToInstall! })
              : versionInUpdate
                ? t('version.to-update', {
                    current: appInfo.versions.current!,
                    update: versionInUpdate!.version,
                  })
                : t('app.version', { version: appInfo.versions.current! })
          }}
        </div>
      </div>

      <div :class="$style.action">
        <ui3n-button
          v-if="canBeInstalled"
          :class="$style.btn"
          block
          type="primary"
          @click="install"
        >
          {{ t('app.action.install') }}
        </ui3n-button>

        <ui3n-button
          v-if="canBeUpdated"
          :class="$style.btn"
          block
          type="primary"
          @click="update"
        >
          {{ t('app.action.update') }}
        </ui3n-button>

        <ui3n-button
          v-if="needToCloseOldVersion"
          :class="$style.btn"
          block
          @click="closeOldVersionApps"
        >
          {{ t('app.action.close_old_version') }}
        </ui3n-button>
      </div>
    </template>

    <template #other>
      <div :class="$style.description">
        <span v-if="appInfo.description">
          {{ appInfo.description }}
        </span>
        <span :class="$style.accented">{{ appId }}</span>
      </div>
      <app-metadata
        :app-info="appInfo"
        expandable
      />

      <div
        v-if="!!installProc"
        :class="$style.progressOverlay"
      >
        <ui3n-progress-circular
          indeterminate
          size="40"
        />
      </div>

      <div
        v-if="!!downloadOrUnzipProc"
        :class="$style.progressOverlay"
      >
        <ui3n-progress-circular
          size="40"
          with-text
          :value="downloadOrUnzipProc.progressValue"
        />
      </div>
    </template>
  </app-item-area>
</template>

<style lang="scss" module>
  .content {
    position: relative;
    width: calc(100% - var(--action-block-width) - var(--spacing-l));
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .status {
    margin: var(--spacing-xs) 0;
  }
  .name {
    font-size: var(--font-16);
    font-weight: 500;
    line-height: var(--font-20);
    color: var(--color-text-block-primary-default);
  }

  .version {
    font-size: var(--font-10);
    font-weight: 500;
    line-height: var(--font-12);
    color: var(--color-text-block-secondary-default);
  }

  .action {
    position: relative;
    width: var(--action-block-width);

    .btn {
      text-transform: capitalize;
    }
  }

  .description {
    position: relative;
    width: calc(100% - var(--action-block-width) - var(--spacing-s));
    margin-top: var(--spacing-s);
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    gap: var(--spacing-xs);
    font-size: var(--font-12);
    font-weight: 400;
    line-height: var(--font-16);
    color: var(--color-text-block-primary-default);
  }

  .accented {
    color: var(--color-text-block-accent-default);
  }

  .progressOverlay {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    background-color: rgb(0, 0, 0, 0.2);
    display: flex;
    justify-content: center;
    align-items: center;
  }
</style>
