/*
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
*/
import { computed, type ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { PLATFORM_ID, type ProcessInfo } from '@/common/store/apps/processes';
import { useAppsStore } from '@/common/store/apps.store';
import { updateVersionIn } from '@/common/utils/versions';
import type { AppInfo } from '@/common/types';

export function useAppsUpdates() {
  const { t } = useI18n();
  const appsStore = useAppsStore();
  const { platform, processes, applicationsInSystem, restart } = storeToRefs(appsStore);
  const {
    checkForAllUpdates,
    downloadPlatformUpdate,
    downloadAndInstallApp,
    installBundledApp,
    updateAppsAndLaunchersInfo,
    closeOldVersionApps,
  } = appsStore;

  const allAppsInSystem = computed(() => applicationsInSystem.value.map(a => a.appId));
  const appsThatNeedUpdate = computed(() =>
    allAppsInSystem.value.filter(appId => {
      const appProcesses = processes.value[appId];
      const app = applicationsInSystem.value.find(a => a.appId === appId);
      const versionInUpdate = updateVersionIn(app!);
      return !appProcesses && versionInUpdate;
    }),
  );

  const platformProc = computed(() => processes.value[PLATFORM_ID]) as ComputedRef<ProcessInfo[] | undefined>;
  const needToRestartPlatformAfterUpdate = computed(() => !!restart.value?.platform);
  const canBePlatformUpdated = computed(() => w3n.system.platform?.downloader &&
    !platformProc.value && !!platform.value.availableUpdates && !needToRestartPlatformAfterUpdate.value
  );
  const downloadPlatformProc = computed(() =>
    platformProc.value?.find(({ procType }) => procType === 'downloading'),
  );

  const canBeAppsUpdated = computed(() =>
    applicationsInSystem.value.reduce(
      (res, app) => {
        const versionInUpdate = updateVersionIn(app);
        res[app.appId] = !processes.value[app.appId] && !!versionInUpdate;

        return res;
      },
      {} as Record<string, boolean>,
    ),
  );

  const needToCloseOldAppsVersion = computed(() =>
    applicationsInSystem.value.reduce(
      (res, app) => {
        res[app.appId] = !!restart.value?.apps?.includes(app.appId);
        return res;
      },
      {} as Record<string, boolean>,
    ),
  );

  async function updateApp(app: AppInfo) {
    const versionInUpdate = updateVersionIn(app);

    if (!versionInUpdate) {
      return;
    }

    try {
      const { version, isBundledVersion } = versionInUpdate;
      if (isBundledVersion) {
        await installBundledApp(app.appId, version);
      } else await downloadAndInstallApp(app, version);
    } finally {
      await updateAppsAndLaunchersInfo();
    }
  }

  return {
    platform,
    processes,
    needToRestartPlatformAfterUpdate,
    canBePlatformUpdated,
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
  };
}
