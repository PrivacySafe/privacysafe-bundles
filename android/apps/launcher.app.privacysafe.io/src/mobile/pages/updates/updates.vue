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
  import { inject, onMounted, ref } from 'vue';
  import { storeToRefs } from 'pinia';
  import isEmpty from 'lodash/isEmpty';
  import { NOTIFICATIONS_KEY } from '@v1nt1248/3nclient-lib/plugins';
  import { Ui3nButton, Ui3nIcon } from '@v1nt1248/3nclient-lib';
  import { useAppStore } from '@/common/store/app.store';
  import { useAppsUpdates } from './useAppsUpdates';
  import type { AppInfo } from '@/common/types';
  import UpdatesPlatform from '@/mobile/components/platform-info.vue';
  import UpdatesApp from '@/mobile/components/app-info.vue';

  const { $createNotice } = inject(NOTIFICATIONS_KEY)!;
  const {
    processes,
    canBePlatformUpdated,
    needToRestartPlatformAfterUpdate,
    downloadPlatformProc,
    applicationsInSystem,
    appsThatNeedUpdate,
    canBeAppsUpdated,
    needToCloseOldAppsVersion,
    t,
    checkForAllUpdates,
    downloadPlatformUpdate,
    updateApp,
    closeOldVersionApps,
  } = useAppsUpdates();

  const appStore = useAppStore();
  const { connectivityStatus } = storeToRefs(appStore);

  const checkProcIsOn = ref(false);

  async function checkForUpdate() {
    try {
      checkProcIsOn.value = true;
      await checkForAllUpdates(true);
    } catch (e) {
      console.error('Error determining need to update applications. ', e);
      $createNotice({
        type: 'error',
        content: t('update_check.messages.error.updates'),
        duration: 4000,
      });
    } finally {
      checkProcIsOn.value = false;
    }
  }

  function getAppInfo(appId: string): AppInfo {
    return applicationsInSystem.value.find(app => app.appId === appId)!;
  }

  async function onPlatformAction(event: 'update' | 'restart') {
    if (event === 'update') {
      await downloadPlatformUpdate();
    } else {
      await w3n.system!.platform!.downloader?.quitAndInstall();
    }
  }

  async function onAppAction(value: { action: 'update' | 'close:old'; app: AppInfo }) {
    console.log('onAppAction => ', value);
    const { action, app } = value;
    if (action === 'update') {
      await updateApp(app);
    } else {
      await closeOldVersionApps();
    }
  }

  onMounted(async () => {
    await checkForUpdate();
  });
</script>

<template>
  <section :class="$style.updates">
    <div
      v-if="connectivityStatus === 'online'"
      :class="$style.action"
    >
      <ui3n-button
        :disabled="checkProcIsOn"
        @click="checkForUpdate"
      >
        {{ checkProcIsOn ? `${t('btn.checking-for-update')} ...` : t('btn.check-update') }}

        <div
          v-if="checkProcIsOn"
          :class="$style.inProcess"
        >
          <ui3n-icon
            icon="spinner"
            size="24"
            color="var(--color-icon-block-accent-default)"
          />
        </div>
      </ui3n-button>
    </div>

    <div :class="$style.body">
      <div
        v-if="checkProcIsOn"
        :class="$style.info"
      >
        {{ t('update_check.in_progress') }}...
      </div>

      <template v-else>
        <div
          v-if="!canBePlatformUpdated && isEmpty(appsThatNeedUpdate)"
          :class="$style.info"
        >
          {{ t('update_check.no_updates') }}
        </div>

        <template v-else>
          <updates-platform
            v-if="canBePlatformUpdated"
            :can-be-platform-updated="canBePlatformUpdated"
            :need-to-restart-platform-after-update="needToRestartPlatformAfterUpdate"
            :download-platform-proc="downloadPlatformProc"
            @action="onPlatformAction"
          />

          <template v-if="!isEmpty(appsThatNeedUpdate)">
            <updates-app
              v-for="appId in appsThatNeedUpdate"
              :key="appId"
              :app-info="getAppInfo(appId)"
              :can-be-updated="canBeAppsUpdated[appId]"
              :need-to-close-old-version="needToCloseOldAppsVersion[appId]"
              :app-processes="processes[appId]"
              @action="onAppAction"
            />
          </template>
        </template>
      </template>
    </div>
  </section>
</template>

<style lang="scss" module>
  .updates {
    --action-block-height: 48px;

    position: relative;
    width: 100%;
    height: 100%;
    padding: var(--spacing-m);
    overflow-x: hidden;
    overflow-y: auto;
  }

  .action {
    display: flex;
    width: 100%;
    height: var(--action-block-height);
    justify-content: center;
    align-items: flex-start;

    button {
      min-width: 176px;
    }
  }

  .inProcess {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .body {
    position: relative;
    width: 100%;
    height: calc(100% - var(--action-block-height));
    overflow-x: hidden;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: stretch;
    row-gap: var(--spacing-s);
  }

  .info {
    position: absolute;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: var(--font-14);
    font-weight: 600;
    line-height: var(--font-18);
    color: var(--color-text-block-primary-default);
  }
</style>
