<!--
 Copyright (C) 2024 - 2026 3NSoft Inc.

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
  import isEmpty from 'lodash/isEmpty';
  import { useAppsStore } from '@/common/store/apps.store';
  import Launchers from '@/desktop/components/app-launchers.vue';

  const { t } = useI18n();

  const appsStore = useAppsStore();
  const { appLaunchers } = storeToRefs(appsStore);

  const nothingToShow = computed(() => isEmpty(appLaunchers.value));
</script>

<template>
  <section :class="$style.applications">
    <div
      v-if="nothingToShow"
      :class="$style.empty"
    >
      {{ t('install.process') }}
    </div>

    <template v-else>
      <launchers
        v-for="app in appLaunchers"
        :key="app.appId + app.version"
        :launchers="app"
      />
    </template>
  </section>
</template>

<style lang="scss" module>
  .applications {
    position: relative;
    width: calc(100% - var(--spacing-s));
    height: calc(100% - var(--spacing-ml));
    margin: var(--spacing-s) 0 var(--spacing-m) 0;
    padding: var(--spacing-m) var(--spacing-xs) var(--spacing-m) var(--spacing-m);
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-gutter: stable;
    display: grid;
    gap: var(--spacing-s);
    grid-template-columns: repeat(4, minmax(145px, 1fr));
    align-content: start;
  }

  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 0 var(--spacing-m);
    font-size: var(--font-18);
    line-height: var(--font-24);
    color: var(--color-text-block-primary-default);
  }

  ::-webkit-scrollbar {
    width: 8px;
  }

  ::-webkit-scrollbar-track {
    background-color: transparent;
  }

  ::-webkit-scrollbar-thumb {
    min-height: 24px;
    background-color: var(--color-bg-control-accent-default);
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background-color: var(--color-bg-control-accent-hover);
    cursor: pointer;
  }
</style>
