/*
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
*/

import { CachedAppLaunchers, makeSystemInfo } from '@/common/store/apps/system-info/cached-system-info';
import { AppInfo, AppLaunchers, Launcher } from '@/common/types';
import { ref } from 'vue';
import { makeAppDistInfo } from './system-info/app-distribution-info';
import { makeCachedAppFiles } from './system-info/cached-app-files';

export function makeAppsAndLaunchersInfoPlace() {
  const appLaunchers = ref<AppLaunchers[]>([]);
  const cacheTS = ref(0);
  const applicationsInSystem = ref<AppInfo[]>([]);

  const { needInitialSetup, getAppsInfoAndLaunchers, init: initSysInfo } = makeSystemInfo(doOnInfoEvent);
  const { getAppDistInfo, getBundleDistInfo, init: initAppDistSrc } = makeAppDistInfo();

  const getFileBytes = makeCachedAppFiles();

  async function initializeCached(): Promise<void> {
    await Promise.all([initAppDistSrc(), initSysInfo()]);
  }

  function getApp(appId: string): AppInfo {
    const app = applicationsInSystem.value.find(({ appId: id }) => id === appId);
    if (!app) {
      throw new Error(`Can't find app with id ${appId}`);
    }
    return app;
  }

  async function doOnInfoEvent(
    appEvent: { upsert?: AppInfo; remove?: string } | undefined,
    launchersEvent: { upsert?: CachedAppLaunchers; remove?: string } | undefined,
  ): Promise<void> {
    if (appEvent?.upsert) {
      const updatedInfo = await appInfoWithIconsFrom(appEvent.upsert);
      const ind = applicationsInSystem.value.findIndex(({ appId }) => appId === updatedInfo.appId);
      if (ind >= 0) {
        applicationsInSystem.value[ind] = updatedInfo;
      } else {
        applicationsInSystem.value.push(updatedInfo);
      }
      sortApplicationsInSystem();
    } else if (appEvent?.remove) {
      const rmInd = applicationsInSystem.value.findIndex(({ appId }) => appId === appEvent.remove);
      if (rmInd >= 0) {
        applicationsInSystem.value.splice(rmInd, 1);
      }
    }
    if (launchersEvent?.upsert) {
      const updatedInfo = await appLaunchersFromInfo(launchersEvent.upsert);
      const ind = appLaunchers.value.findIndex(({ appId }) => appId === updatedInfo.appId);
      if (ind >= 0) {
        appLaunchers.value[ind] = updatedInfo;
      } else {
        appLaunchers.value.push(updatedInfo);
      }

      sortLaunchers();
    } else if (launchersEvent?.remove) {
      const rmInd = appLaunchers.value.findIndex(({ appId }) => appId === launchersEvent.remove);
      if (rmInd >= 0) {
        appLaunchers.value.slice(rmInd, 1);
      }
    }
  }

  async function fetchAppsInfo(refreshCache = true) {
    // note that this call is sending events during await here
    const { cacheTS: dataTS } = await getAppsInfoAndLaunchers(!!refreshCache);
    if (cacheTS.value === dataTS) {
      return;
    }
    cacheTS.value = dataTS;
  }

  function sortApplicationsInSystem() {
    // beautify
    applicationsInSystem.value.sort(byName);
  }

  function sortLaunchers() {
    // beautify
    appLaunchers.value.sort(byName);
    const contactsAppInd = appLaunchers.value.findIndex(({ appId }) => appId === 'contacts.app.privacysafe.io');
    if (contactsAppInd > 0) {
      const contactsLauncher = appLaunchers.value.splice(contactsAppInd, 1)[0];
      appLaunchers.value.unshift(contactsLauncher);
    }
  }
  async function appInfoWithIconsFrom(info: AppInfo): Promise<AppInfo> {
    const { appId, icon, versions } = info;
    const iconBytes = icon ? await getFileBytes(appId, versions.latest, icon) : undefined;
    return {
      ...info,
      iconBytes,
    };
  }

  async function appLaunchersFromInfo(info: CachedAppLaunchers): Promise<AppLaunchers> {
    const { appId, version, name, description, icon, tags } = info;
    const iconBytes = icon ? await getFileBytes(appId, version, icon) : undefined;
    const defaultLauncher = info.defaultLauncher
      ? await appLauncherFromInfo(appId, version, info.defaultLauncher)
      : undefined;
    const staticLaunchers: AppLaunchers['staticLaunchers'] = [];
    if (info.staticLaunchers) {
      for (const l of info.staticLaunchers) {
        staticLaunchers.push(await appLauncherFromInfo(appId, version, l));
      }
    }
    // XXX dynamic launchers array is empty, till it gets implemented
    const dynamicLaunchers: AppLaunchers['dynamicLaunchers'] = [];
    return {
      appId,
      version,
      name,
      description,
      icon,
      iconBytes,
      tags,
      dynamicLaunchers,
      staticLaunchers,
      defaultLauncher,
    };
  }

  async function appLauncherFromInfo(
    appId: string,
    version: string,
    { description, icon, name, component, formFactor, startCmd }: web3n.caps.Launcher,
  ): Promise<Launcher> {
    const iconBytes = icon ? await getFileBytes(appId, version, icon) : undefined;
    return {
      description,
      icon,
      name,
      component,
      formFactor,
      startCmd,
      iconBytes,
    };
  }

  return {
    appLaunchers,
    applicationsInSystem,

    getApp,
    fetchAppsInfo,
    needInitialSetup,
    getAppDistInfo,
    getBundleDistInfo,

    initializeCached,
  };
}

function byName(a: { name: string }, b: { name: string }): -1 | 0 | 1 {
  const aName = a.name.toLowerCase();
  const bName = b.name.toLowerCase();
  if (aName < bName) {
    return -1;
  } else if (aName > bName) {
    return 1;
  } else {
    return 0;
  }
}
