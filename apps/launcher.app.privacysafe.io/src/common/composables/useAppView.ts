/*
 Copyright (C) 2024 - 2025 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

 This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with this program. If not, see <http://www.gnu.org/licenses/>.
*/
import { computed, type ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { updateVersionIn } from '@/common/utils/versions';
import type { AppInfo } from '@/common/types';
import { useAppsStore } from '@/common/store/apps.store';

export function useAppView(props: ComputedRef<AppInfo>) {
  const { t } = useI18n();

  const appId = computed(() => props.value.appId);

  const appsStore = useAppsStore();
  const {
    downloadAndInstallApp,
    installBundledApp,
    installAppFromPack,
    closeOldVersionApps,
    updateAppsAndLaunchersInfo,
  } = appsStore;
  const { restart, processes } = storeToRefs(appsStore);
  const needToCloseOldVersion = computed(() => !!restart.value?.apps?.includes(appId.value));
  const appProcesses = computed(() => processes.value[appId.value]);

  const installProc = computed(() => appProcesses.value?.find(({ procType }) => procType === 'installing'));

  const downloadOrUnzipProc = computed(() =>
    appProcesses.value?.find(({ procType }) => procType === 'downloading' || procType === 'unzipping'),
  );

  const versionToInstall = computed(() => props.value.versions.latest);
  const canBeInstalled = computed(
    () => !appProcesses.value && !props.value.versions.current && !!versionToInstall.value,
  );

  const versionInUpdate = computed(() => updateVersionIn(props.value));
  const canBeUpdated = computed(() => !appProcesses.value && !!versionInUpdate.value);

  async function install() {
    if (!canBeInstalled.value) {
      return;
    }

    if (props.value.versions.packs?.includes(versionToInstall.value)) {
      await installAppFromPack(appId.value, props.value.versions.latest);
    } else {
      await installBundledApp(appId.value, props.value.versions.bundled!);
    }
  }

  async function update() {
    if (!versionInUpdate.value) {
      return;
    }
    try {
      const { version, isBundledVersion } = versionInUpdate.value;
      if (isBundledVersion) {
        await installBundledApp(appId.value, version);
      } else {
        await downloadAndInstallApp(props.value, version);
      }
    } finally {
      await updateAppsAndLaunchersInfo();
    }
  }

  return {
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
  };
}
