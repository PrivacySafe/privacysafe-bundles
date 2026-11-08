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
  import { computed } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { Ui3nButton, Ui3nProgressCircular } from '@v1nt1248/3nclient-lib';
  import psIcon from '@/common/assets/images/platform-icon.png';
  import { PLATFORM_ID } from '@/common/store/apps/processes';
  import { useAppsStore } from '@/common/store/apps.store';
  import AppIcon from '@/common/components/app-icon.vue';
  import AppItemArea from './app-item-area.vue';

  const { t } = useI18n();

  const appsStore = useAppsStore();
  const { platform, restart, processes } = storeToRefs(appsStore);
  const { downloadPlatformUpdate } = appsStore;

  const platformProc = computed(() => processes.value[PLATFORM_ID]);

  const downloadProc = computed(() => platformProc.value?.find(({ procType }) => procType === 'downloading'));

  const needToRestartAfterUpdate = computed(() => !!restart.value?.platform);

  const canBeUpdated = computed(
    () => !platformProc.value && !!platform.value.availableUpdates && !needToRestartAfterUpdate.value,
  );

  async function update() {
    await downloadPlatformUpdate();
  }

  function quitAndInstall() {
    w3n.system!.platform!.downloader?.quitAndInstall();
  }
</script>

<template>
  <app-item-area>
    <template #main>
      <app-icon :icon-url="psIcon" />

      <div :class="$style.content">
        <div :class="$style.name">
          {{ t('platform.title') }}
        </div>

        <div :class="$style.version">
          {{ t('app.version', { version: platform.version }) }}
        </div>
      </div>

      <div :class="$style.action">
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
          v-if="needToRestartAfterUpdate"
          :class="$style.btn"
          block
          type="primary"
          @click="quitAndInstall"
        >
          {{ t('platform.action_restart') }}
        </ui3n-button>
      </div>
    </template>

    <template #other>
      <div :class="$style.description">
        {{ t('platform.description') }}
      </div>

      <div
        v-if="!!downloadProc"
        :class="$style.progressOverlay"
      >
        <ui3n-progress-circular
          size="40"
          with-text
          :value="downloadProc.progressValue"
        />
      </div>
    </template>
  </app-item-area>
</template>

<style lang="scss" module>
  .content {
    position: relative;
    width: calc(100% - 4 * var(--spacing-ml) - 2 * var(--spacing-s));
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
