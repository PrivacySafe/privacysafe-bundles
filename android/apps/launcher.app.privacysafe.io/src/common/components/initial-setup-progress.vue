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
<script lang="ts" setup>
  import { useI18n } from 'vue-i18n';
  import { storeToRefs } from 'pinia';
  import { Ui3nProgressCircular, Ui3nProgressLinear } from '@v1nt1248/3nclient-lib';
  import { useAppsStore } from '@/common/store/apps.store';

  const { t } = useI18n();

  const appsStore = useAppsStore();
  const { initialSetup, initialSetupCurrentApp } = storeToRefs(appsStore);
</script>

<template>
  <template v-if="initialSetup">
    <span>
      {{ t('install.progress', { installed: initialSetup.installed, total: initialSetup.total }) }}
    </span>

    <ui3n-progress-circular
      :value="Math.floor((initialSetup.installed / initialSetup.total) * 100)"
      :size="120"
      :width="4"
    />

    <div
      v-if="initialSetupCurrentApp"
      :class="$style.currentApp"
    >
      <span :class="$style.currentAppText">
        {{
          t(initialSetupCurrentApp.stage === 'unzipping' ? 'install.unpacking' : 'install.installing', {
            name: initialSetupCurrentApp.name,
          })
        }}
      </span>

      <ui3n-progress-linear
        v-if="initialSetupCurrentApp.stage === 'unzipping'"
        :value="initialSetupCurrentApp.progressValue ?? 0"
        :height="4"
      />

      <ui3n-progress-linear
        v-else
        :height="4"
        indeterminate
      />
    </div>
  </template>
</template>

<style lang="scss" module>
  .currentApp {
    width: 100%;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    row-gap: var(--spacing-xs);
  }

  .currentAppText {
    font-size: var(--font-14);
    line-height: var(--font-20);
    text-align: center;
    color: var(--color-text-block-secondary-default);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
