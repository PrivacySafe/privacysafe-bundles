/*
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
*/

import { ref } from 'vue';
import { defineStore } from 'pinia';
import { makeProcessesPlace } from './apps/processes';
import { AppInfo, ChannelVersion } from '@/common/types';
import { downloadApp, installApp } from './apps/app-operations';
import { SingleProc, makeSyncedFunc } from '@v1nt1248/3nclient-lib/utils';
import { makeRestartInfoPlace } from './apps/restart-info';
import { makeAppsAndLaunchersInfoPlace } from './apps/apps-and-launchers-info';
import { makePlatform } from './apps/platform';
import { compare as compareSemVer } from 'semver';
import { debouncedFnCall } from '@/common/utils/debounce';
import { makeConfs } from './apps/system-info/confs';
import { observerToGeneratorPipe } from '../utils/observer-utils';

function canUpdateBundle(current: BundleVersions, latestAvailable: BundleVersions): boolean {
  const platDiff = compareSemVer(current.platform, latestAvailable.platform);
  if (platDiff < 0) {
    return true;
  } else if (platDiff > 0) {
    return false;
  }

  const currBundleNum = bundleNumFromVersion(current.bundle);
  const latestBundleNum = bundleNumFromVersion(latestAvailable.bundle);
  if (currBundleNum >= latestBundleNum) {
    return false;
  }

  for (const [appId, version] of Object.entries(latestAvailable.apps)) {
    const currVer = current.apps[appId];
    if (currVer === undefined || compareSemVer(currVer, version) < 0) {
      return true;
    }
  }

  return false;
}

function bundleNumFromVersion(v: string): number {
  return parseInt(v.substring(v.lastIndexOf((v.includes('+') ? '+' : '.') + 1)));
}

export const useAppsStore = defineStore('apps', () => {
  const confs = makeConfs();
  const { processes, delProcess, upsertProcess, emitEvent } = makeProcessesPlace();

  const autoUpdate = ref(true);
  const {
    appLaunchers,
    applicationsInSystem,
    getApp,
    fetchAppsInfo,
    initializeCached,
    needInitialSetup,
    getAppDistInfo,
    getBundleDistInfo,
  } = makeAppsAndLaunchersInfoPlace();
  const { restart, setAppsRestart, setPlatformRestart } = makeRestartInfoPlace();
  const { platform, downloadPlatformUpdate } = makePlatform(
    delProcess,
    upsertProcess,
    restart,
    setPlatformRestart,
  );

  function toggleAutoUpdate(value?: boolean): void {
    if (typeof value === 'boolean') {
      autoUpdate.value = value;
    } else {
      autoUpdate.value = !autoUpdate.value;
    }
    confs.setAutoUpdate(autoUpdate.value);
  }

  async function initialize(): Promise<void> {
    await Promise.all([
      initializeCached(),

      confs
        .init()
        .then(async () => {
          autoUpdate.value = await confs.getAutoUpdate();
        })
        .catch(err => w3n.log('error', `Initializing launcher confs threw an error`, err)),

      w3n
        .system!.platform!.getCurrentVersion()
        .then(v => {
          platform.value.version = v.bundle;
        })
        .catch(err => w3n.log('error', `Initializing launcher info threw an error`, err)),
    ]);
  }

  async function checkAppUpdates(app: AppInfo, forceInfoDownload: boolean): Promise<void> {
    const {
      appId,
      versions: { current },
    } = app;
    upsertProcess(appId, {
      procType: 'update-checking',
    });
    try {
      const distInfo = await getAppDistInfo(appId, forceInfoDownload);
      if (!distInfo) {
        app.updates = undefined;
        if (app.versions.bundled && compareSemVer(current!, app.versions.bundled) < 0) {
          app.updateFromBundle = app.versions.bundled;
        }
        return;
      }

      const updateOpts: NonNullable<AppInfo['updates']> = [];
      for (const [channel, version] of Object.entries(distInfo.versions)) {
        if (compareSemVer(current!, version) < 0) {
          updateOpts.push({ channel, version });
        }
      }
      if (updateOpts.length > 0) {
        app.updates = updateOpts;
      } else if (app.updates) {
        app.updates = undefined;
      }
      if (app.versions.bundled && compareSemVer(current!, app.versions.bundled) < 0) {
        app.updateFromBundle = app.versions.bundled;
      }
    } finally {
      delProcess(appId, 'update-checking');
    }
  }

  async function checkPlatformUpdates(forceInfoDownload: boolean): Promise<void> {
    upsertProcess(null, {
      procType: 'update-checking',
    });
    try {
      const distInfo = await getBundleDistInfo(forceInfoDownload);
      if (!distInfo) {
        return;
      }

      const currentVer = await w3n.system!.platform!.getCurrentVersion();
      const updateOpts: ChannelVersion[] = [];
      for (const [channel, latestChannelVer] of Object.entries(distInfo.versions)) {
        if (canUpdateBundle(currentVer, latestChannelVer)) {
          updateOpts.push({ channel, version: latestChannelVer.bundle });
        }
      }
      if (updateOpts.length > 0) {
        platform.value.availableUpdates = updateOpts;
      }
    } finally {
      delProcess(null, 'update-checking');
    }
  }

  const downloadAndInstallApp = debouncedFnCall(async function downloadAndInstallApp(
    app: AppInfo,
    version: string,
  ): Promise<PostInstallState | undefined> {
    try {
      if (!app.versions.packs || !app.versions.packs.includes(version)) {
        await downloadApp(app.appId, version, delProcess, upsertProcess);
      }
      return await installApp(app.appId, version, delProcess, upsertProcess);
    } catch (err) {
      await w3n.log('error', `Failed to download and install app ${app.appId} version ${version}`, err);
    }
  });

  async function unpackBundledApp(appId: string): Promise<void> {
    upsertProcess(appId, {
      procType: 'unzipping',
      progressValue: 0,
    });
    try {
      const { obs, generator: unpackEvents } = observerToGeneratorPipe<web3n.system.apps.AppUnpackProgress>();
      w3n.system!.apps!.installer!.addPackFromBundledApps(appId, obs);
      for await (const ev of unpackEvents) {
        if (!ev) {
          continue;
        }
        const { numOfFiles, numOfProcessed } = ev;
        const progressValue = Math.floor((numOfProcessed / numOfFiles) * 100);
        upsertProcess(appId, {
          procType: 'unzipping',
          progressValue,
        });
      }
    } finally {
      delProcess(appId, 'unzipping');
    }
  }

  const installBundledApp = debouncedFnCall(
    async function installBundledApp(appId: string, version: string): Promise<void> {
      try {
        try {
          await unpackBundledApp(appId);
        } catch (err) {
          await w3n.log('error', `Failed to unpack bundled version of app ${appId}`, err);
          return;
        }
        try {
          await installApp(appId, version, delProcess, upsertProcess);
        } catch (err) {
          await w3n.log('error', `Failed to install app ${appId} version ${version}`, err);
          return;
        }
      } finally {
        await updateAppsAndLaunchersInfo();
      }
    },
    (appId: string) => appId,
  );

  const installAppFromPack = debouncedFnCall(
    async function installAppFromPack(appId: string, version: string): Promise<void> {
      try {
        try {
          await installApp(appId, version, delProcess, upsertProcess);
        } catch (err) {
          await w3n.log('error', `Failed to install app ${appId} version ${version}`, err);
          return;
        }
      } finally {
        await updateAppsAndLaunchersInfo();
      }
    },
    (appId: string) => appId,
  );

  const checkForAllUpdates = debouncedFnCall(async function checkForAllUpdates(
    forceInfoDownload = false,
  ): Promise<void> {
    const installedApps = applicationsInSystem.value.filter(({ versions: { current } }) => !!current);
    for (const app of installedApps) {
      await checkAppUpdates(app, forceInfoDownload);
    }
    await checkPlatformUpdates(forceInfoDownload);
  });

  async function checkAndInstallAllUpdates(applyUpdates?: boolean): Promise<void> {
    await checkForAllUpdates();
    if (applyUpdates || autoUpdate.value) {
      await downloadAndInstallAllAppUpdates();
      await downloadPlatformUpdate();
    }
  }

  async function downloadAndInstallAllAppUpdates(): Promise<void> {
    const appsAndVersionsToInstall = applicationsInSystem.value
      .filter(app => !!app.updates)
      .map(app => ({
        app,
        version: app.updates![0].version,
      }));

    const appsToRestart: string[] = [];

    for (const { app, version } of appsAndVersionsToInstall) {
      const postInstallState = await downloadAndInstallApp(app, version);
      if (postInstallState && postInstallState !== 'all-done') {
        appsToRestart.push(app.appId);
      }
    }

    setAppsRestart(appsToRestart.length > 0 ? appsToRestart : undefined);

    await updateAppsAndLaunchersInfo();
  }

  const closeOldVersionApps = debouncedFnCall(async () => {
    const appsToClose = restart.value?.apps;
    if (!appsToClose) {
      return;
    }
    setAppsRestart(undefined);
    if (appsToClose.length === 0) {
      return;
    }
    await w3n.system!.apps!.opener!.closeAppsAfterUpdate(appsToClose);
  });

  async function isFirstTimeOpened(): Promise<boolean> {
    return appLaunchers.value.length === 0 && (await needInitialSetup());
  }

  const updateAppsAndLaunchersInfo = makeSyncedFunc(new SingleProc(), undefined, async () => {
    await fetchAppsInfo();
  });

  async function fetchCachedInfo() {
    await fetchAppsInfo(false);
  }

  const installBundledAppsIntoNewSystem = debouncedFnCall(async function installBundledAppsIntoNewSystem() {
    const { 'app-packs': appPacks } = await w3n.system!.platform!.getCurrentVersion();
    const bundledAppsForInstall = Object.entries(appPacks).map(([id, version]) => ({ id, version }));

    if (bundledAppsForInstall.length === 0) {
      console.log(`There are no bundled apps to install on first run`);
      return;
    }

    emitEvent({
      'init-setup:start': {
        bundledAppsForInstall: bundledAppsForInstall.map(({ id }) => id),
      },
    });

    for (const { id, version } of bundledAppsForInstall) {
      try {
        await installBundledApp(id, version);
        await updateAppsAndLaunchersInfo();
      } catch (err) {
        console.error(`Error occured during installation of bundled app ${id}, version ${version}`, err);
      }
    }

    emitEvent({ 'init-setup:done': null });

    w3n.system!.apps!.opener!.triggerAllStartupLaunchers();

    updateAppsAndLaunchersInfo();
  });

  async function addAppPackFromFile(file: web3n.files.ReadonlyFile) {
    // XXX appId isn't known. Progress event can actually send it at some initial point
    // upsertProcess(appId, {
    //   procType: 'unzipping',
    //   progressValue: 0,
    // });

    const { obs, generator: unpackEvents } = observerToGeneratorPipe<web3n.system.apps.AppUnpackProgress>();
    w3n.system.apps!.installer!.addAppPackFromZipFile(file, obs);
    try {
      for await (const ev of unpackEvents) {
        if (!ev) {
          continue;
        }
        // XXX
        // const { numOfFiles, numOfProcessed } = ev;
        // const progressValue = Math.floor((numOfProcessed / numOfFiles) * 100);
        // upsertProcess(appId, {
        //   procType: 'unzipping',
        //   progressValue,
        // });

        console.log(ev);
      }
      // XXX
    } catch (err) {
      // XXX

      console.error(`After the loop`, err);
    } finally {
      // XXX
      // delProcess(appId, 'unzipping');
      await updateAppsAndLaunchersInfo();
    }
  }

  return {
    autoUpdate,
    appLaunchers,
    applicationsInSystem,
    platform,
    restart,
    processes,

    getApp,
    toggleAutoUpdate,
    initialize,

    isFirstTimeOpened,
    installBundledAppsIntoNewSystem,

    downloadAndInstallApp,
    installBundledApp,
    installAppFromPack,
    downloadPlatformUpdate,
    checkForAllUpdates,
    checkAndInstallAllUpdates,
    closeOldVersionApps,
    updateAppsAndLaunchersInfo,
    fetchCachedInfo,
    addAppPackFromFile,
  };
});
