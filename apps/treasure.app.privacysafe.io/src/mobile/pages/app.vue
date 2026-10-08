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
<script setup lang="ts">
  import { ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Ui3nDialogProvider, Ui3nProgressCircular, Ui3nProgressLinear } from '@v1nt1248/3nclient-lib';
  import { useAppPage } from '@/common/composables/use-app-page';
  import AppMenu from '@/mobile/components/app-menu.vue';

  const { t } = useI18n();

  const { appVersion, commonLoading, user, connectivityStatus, isSyncRunning, runMenuAction } = useAppPage();

  const isMenuOpen = ref(false);
</script>

<template>
  <section :class="$style.app">
    <div :class="$style.body">
      <div :class="$style.toolbar">
        <app-menu
          :is-menu-open="isMenuOpen"
          :user="user || ''"
          :connectivity-status="connectivityStatus"
          @action="ev => runMenuAction(ev)"
          @update:model-value="ev => (isMenuOpen = ev)"
        />

        <div :class="$style.item">
          <span :class="$style.itemName">
            {{ t('app.title') }}
          </span>

          <span :class="$style.version">
            {{ appVersion }}
          </span>
        </div>

        <div :class="$style.info">
          <div :class="$style.status">
            <span>{{ t('app.status.label') }}</span>

            <b :class="connectivityStatus === 'online' && $style.ok" />
          </div>
        </div>

        <div
          v-if="isSyncRunning"
          :class="$style.processing"
        >
          <ui3n-progress-linear indeterminate />
        </div>
      </div>

      <div :class="$style.content">
        <router-view v-slot="{ Component }">
          <transition>
            <component :is="Component" />
          </transition>
        </router-view>

        <div
          v-if="commonLoading"
          :class="$style.loader"
        >
          <ui3n-progress-circular
            indeterminate
            size="100"
            width="4"
          />
        </div>
      </div>
    </div>

    <ui3n-dialog-provider />
  </section>
</template>

<style lang="scss" module>
  .app {
    --app-toolbar-height: 64px;

    position: fixed;
    inset: 0;
    display: flex;
    justify-content: flex-start;
    align-items: stretch;
    overflow: hidden;
  }

  .body {
    position: relative;
    min-width: 100%;
    width: 100%;
    height: calc(100% - var(--spacing-s));

    .content {
      position: relative;
      width: 100%;
      height: calc(100% - var(--app-toolbar-height) - 1px);
    }
  }

  .toolbar {
    position: relative;
    width: 100%;
    height: var(--app-toolbar-height);
    padding: 0 var(--spacing-m) 0 var(--spacing-s);
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--color-border-block-primary-default);
    background-color: var(--color-bg-block-primary-default);

    .item {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      column-gap: var(--spacing-s);

      .itemName {
        font-size: var(--font-18);
        font-weight: 700;
        color: var(--color-text-block-primary-default);
      }

      .version {
        font-size: var(--font-12);
        line-height: var(--font-14);
        color: var(--color-text-block-secondary-default);
      }
    }

    .info {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      color: var(--color-text-control-primary-default);

      .status {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        column-gap: var(--spacing-s);
        font-size: var(--font-12);
        font-weight: 500;

        b {
          position: relative;
          width: 12px;
          min-width: 12px;
          height: 12px;
          min-height: 12px;
          border-radius: 50%;
          background-color: var(--warning-content-default);
        }

        .ok {
          background-color: var(--success-content-default);
        }
      }
    }

    .processing {
      position: absolute;
      left: 0;
      width: 100%;
      bottom: 0;
    }
  }

  .loader {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }
</style>
