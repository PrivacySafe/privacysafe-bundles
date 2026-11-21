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
  import { Ui3nButton } from '@v1nt1248/3nclient-lib';
  import { storeToRefs } from 'pinia';
  import type { AppInfo } from '@/common/types';
  import { useAppsStore } from '@/common/store/apps.store';
  import { PLATFORM_ID } from '@/common/store/apps/processes';
  import psIcon from '@/common/assets/images/platform-icon.png';
  import AppIcon from '@/common/components/app-icon.vue';
  import AppStatus from '@/common/components/app-status.vue';
  import AppMetadata from '@/common/components/app-metadata.vue';

  const props = defineProps<{
    appData: AppInfo & { version: string };
  }>();
  const emits = defineEmits<{
    (event: 'close'): void;
  }>();

  const { t } = useI18n();
  const appsStore = useAppsStore();
  const { processes } = storeToRefs(appsStore);
  const { installAppFromPack, installBundledApp } = appsStore;

  const appId = computed(() => props.appData.appId);

  const itemProc = computed(() => (appId.value === PLATFORM_ID ? null : processes.value[appId.value]));
  const versionToInstall = computed(() => (appId.value === PLATFORM_ID ? null : props.appData.versions?.latest));

  const showInstall = computed(
    () => appId.value !== PLATFORM_ID && !props.appData.versions.current && !!versionToInstall.value,
  );
  const canBeInstalled = computed(() => showInstall.value && !itemProc.value);

  async function install() {
    if (!canBeInstalled.value) {
      return;
    }

    if (props.appData.versions.packs?.includes(versionToInstall.value!)) {
      await installAppFromPack(appId.value, props.appData.versions.latest);
    } else {
      await installBundledApp(appId.value, props.appData.versions!.bundled!);
    }
  }
</script>

<template>
  <div :class="$style.appStoreItem">
    <div :class="$style.toolbar">
      <ui3n-button
        type="icon"
        color="var(--color-bg-block-primary-default)"
        icon="round-arrow-back"
        icon-color="var(--color-icon-block-primary-default)"
        icon-size="32"
        @click="emits('close')"
      />
    </div>

    <div :class="$style.body">
      <div :class="$style.content">
        <app-icon
          :icon-url="appId === PLATFORM_ID ? psIcon : undefined"
          :icon-bytes="appId !== PLATFORM_ID ? appData.iconBytes : undefined"
          size="48"
        />

        <div :class="$style.name">
          {{ appData.name }}
        </div>

        <app-status
          v-if="appId !== PLATFORM_ID"
          :tags="appData.tags"
        />

        <div
          v-if="appId !== PLATFORM_ID"
          :class="$style.subname"
        >
          {{ appData.appId }}
        </div>

        <div :class="$style.version">
          {{ appData.version }}
        </div>

        <div :class="$style.description">
          {{ appData.description }}
        </div>

        <app-metadata
          v-if="appId !== PLATFORM_ID"
          :app-info="appData"
        />

        <div
          v-if="showInstall"
          :class="$style.action"
        >
          <ui3n-button
            block
            :disabled="!canBeInstalled"
            @click="install"
          >
            {{ t('app.action.install') }}
          </ui3n-button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
  .appStoreItem {
    --app-store-item-toolbar-height: 64px;

    position: fixed;
    left: 0;
    top: 0;
    width: 100%;
    height: 100dvh;
    padding: 0 0 var(--spacing-m) 0;
    background-color: var(--color-bg-block-primary-default);
  }

  .toolbar {
    display: flex;
    width: 100%;
    height: var(--app-store-item-toolbar-height);
    padding: 0 var(--spacing-m) 0 var(--spacing-s);
    justify-content: flex-start;
    align-items: center;
    border-bottom: 1px solid var(--color-border-block-primary-default);

    button {
      width: var(--spacing-xxl) !important;
      min-width: var(--spacing-xxl) !important;
      height: var(--spacing-xxl);
    }
  }

  .body {
    position: relative;
    width: 100%;
    height: calc(100% - var(--app-store-item-toolbar-height));
    padding: var(--spacing-m) var(--spacing-s) var(--spacing-s) var(--spacing-m);
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-gutter: stable;
  }

  .content {
    display: flex;
    width: 100%;
    padding-right: var(--spacing-s);
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    row-gap: var(--spacing-s);
  }

  .name {
    font-size: var(--font-16);
    font-weight: 500;
    color: var(--color-text-block-primary-default);
    text-align: center;
  }

  .subname {
    font-size: var(--font-10);
    color: var(--color-text-block-accent-default);
    overflow-wrap: break-word;
    text-align: center;
  }

  .version {
    font-size: var(--font-10);
    font-weight: 600;
    color: var(--color-text-block-secondary-default);
    text-align: center;
  }

  .description {
    position: relative;
    width: 100%;
    font-size: var(--font-14);
    font-weight: 500;
    line-height: var(--font-18);
    color: var(--color-text-block-primary-default);
    overflow-wrap: anywhere;
    text-align: left;
  }

  .action {
    position: relative;
    padding-top: var(--spacing-m);
    width: 50%;
  }
</style>
