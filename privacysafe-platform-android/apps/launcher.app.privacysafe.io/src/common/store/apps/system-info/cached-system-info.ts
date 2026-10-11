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

import { deepEqual } from '@/common/lib-common/json-utils';
import { getDynamicLaunchersLocations, getLaunchersForUser } from '@/common/lib-common/manifest-utils';
import { AppInfo } from '@/common/types';
import { SingleProc } from '@v1nt1248/3nclient-lib/utils';
import { compare as compareSemVer } from 'semver';

type WritableFS = web3n.files.WritableFS;
type FileException = web3n.files.FileException;
type Launcher = web3n.caps.Launcher;
type AppManifest = web3n.caps.AppManifest;
type DynamicLaunchers = web3n.caps.DynamicLaunchers;

interface CachedAppVersions {
  createdByVersion: string;
  formatVer: 3;
  stateTS: number;
  apps: Record<string, AppInfo>;
  launchers: Record<string, CachedAppLaunchers>;
}

export interface CachedAppLaunchers {
  appId: string;
  version: string;
  name: string;
  icon: string;
  description: string;
  tags?: string[];
  defaultLauncher?: Launcher;
  staticLaunchers?: Launcher[];
  dynLaunchers?: DynamicLaunchers[];
}

const appVersionsPath = '/cached/app-versions.json';

export function makeSystemInfo(
  onInfoEvent: (
    appEvent: { upsert?: AppInfo; remove?: string } | undefined,
    launchersEvent: { upsert?: CachedAppLaunchers; remove?: string } | undefined,
  ) => void,
) {
  let myVersion = '';
  let stateTS = 0;
  let launchers: CachedAppVersions['launchers'] = {};
  let apps: CachedAppVersions['apps'] = {};
  let fs: WritableFS | undefined = undefined;
  const refreshProc = new SingleProc();

  async function init(): Promise<void> {
    myVersion = await w3n.myVersion();
    return refreshProc.start(async () => {
      fs = await w3n.storage!.getAppLocalFS!();
      try {
        const cached = await fs.readJSONFile<CachedAppVersions>(appVersionsPath);
        if (cached.createdByVersion !== myVersion || cached.formatVer !== 3) {
          await unsyncedAppVersionsRefresh();
        } else {
          stateTS = cached.stateTS;
          launchers = cached.launchers;
          Object.values(launchers).forEach(l => onInfoEvent(undefined, { upsert: l }));
          apps = cached.apps;
          Object.values(apps).forEach(app => onInfoEvent({ upsert: app }, undefined));
        }
      } catch (exc) {
        if (!(exc as FileException).notFound) {
          throw exc;
        }
        await unsyncedAppVersionsRefresh();
      }
    });
  }

  async function unsyncedAppVersionsRefresh(): Promise<number> {
    const appVersions = await getAppVersionsFromW3N();
    const { addedOrChanged, removed } = diffAppVersions(appVersions, apps);

    if (addedOrChanged.size === 0 && removed.size === 0) {
      return stateTS;
    }

    stateTS = Date.now();

    // remove removed apps
    for (const id of removed) {
      delete apps[id];
      delete launchers[id];
      onInfoEvent({ remove: id }, { remove: id });
    }

    // create new values for added or changed apps
    for (const [id, appVersions] of addedOrChanged.entries()) {
      const info = await getAppInfo(id, appVersions);
      if (info) {
        const { appInfo, currentManif } = info;
        apps[id] = appInfo;
        const appLaunchers = await getAppLaunchers(id, currentManif);
        if (appLaunchers) {
          launchers[id] = appLaunchers;
          onInfoEvent({ upsert: appInfo }, { upsert: appLaunchers });
        } else {
          delete launchers[id];
          onInfoEvent({ upsert: appInfo }, { remove: id });
        }
      } else {
        delete apps[id];
        delete launchers[id];
        onInfoEvent({ remove: id }, { remove: id });
      }
    }

    await fs!.writeJSONFile(appVersionsPath, {
      createdByVersion: myVersion,
      formatVer: 3,
      stateTS: stateTS,
      launchers: launchers,
      apps: apps,
    } as CachedAppVersions);

    return stateTS;
  }

  async function getAppsInfoAndLaunchers(refreshCache?: boolean): Promise<{
    cacheTS: number;
    launchers: CachedAppLaunchers[];
    apps: AppInfo[];
  }> {
    const refreshing = refreshProc.getP();
    if (refreshing) {
      await refreshing;
    } else if (refreshCache) {
      await refreshProc.addStarted(unsyncedAppVersionsRefresh());
    }
    return {
      cacheTS: stateTS,
      apps: Object.values(apps).concat(),
      launchers: Object.values(launchers).concat(),
    };
  }

  async function needInitialSetup(): Promise<boolean> {
    await refreshProc.getP();
    const foundAppWithPacks = !!Object.values(apps).find(
      app => app.versions.packs && app.versions.packs.length > 0,
    );
    return !foundAppWithPacks;
  }

  async function getAppsInfo(): Promise<{
    cacheTS: number;
    apps: AppInfo[];
  }> {
    await refreshProc.getP();
    return {
      cacheTS: stateTS,
      apps: Object.values(apps).concat(),
    };
  }

  return {
    init,
    getAppsInfo,
    getAppsInfoAndLaunchers,
    needInitialSetup,
  };
}

async function getAppInfo(
  id: string,
  { bundled, current, packs }: AppVersions,
): Promise<{ appInfo: AppInfo; currentManif?: AppManifest } | undefined> {
  const latest = latestVersionOf({ bundled, current, packs });
  if (!latest) {
    return;
  }

  const m = await w3n.system!.apps!.installer!.getAppManifest(id, latest);
  if (!m) {
    return;
  }
  if (m.appDomain !== id) {
    w3n.log('error', `Application with id ${id} has manifest with a different app domain field ${m.appDomain}`);
    return;
  }

  const appId = m.appDomain;
  const { name, description, icon, tags, publisher, website, contact, policy, terms, license, source } = m;
  const appInfo: AppInfo = {
    appId,
    name,
    description,
    icon,
    tags,
    publisher,
    website,
    contact,
    policy,
    terms,
    license,
    source,
    versions: {
      latest,
      current,
      packs,
      bundled,
    },
  };

  return { appInfo, currentManif: m.version === current ? m : undefined };
}

function latestVersionOf({ bundled, current, packs }: AppVersions): string | undefined {
  const all = packs ? packs.concat() : [];
  if (current) {
    all.push(current);
  }
  if (bundled) {
    all.push(bundled);
  }
  if (all.length === 0) {
    return;
  } else if (all.length === 1) {
    return all[0];
  } else {
    return all.reduce((v1, v2) => (compareSemVer(v1, v2) === 1 ? v1 : v2));
  }
}

async function getAppLaunchers(id: string, m: AppManifest | undefined): Promise<CachedAppLaunchers | undefined> {
  if (!m) {
    m = await w3n.system!.apps!.opener!.getAppManifestOfCurrent(id);
  }
  if (!m) {
    return;
  }
  if (m.appDomain !== id) {
    w3n.log('error', `Application with id ${id} has manifest with a different app domain field ${m.appDomain}`);
    return;
  }

  const appId = m.appDomain;
  const { version, name, description, icon, tags } = m;

  const formFactor = await w3n.ui.uiFormFactor();
  const staticLaunchers = getLaunchersForUser(m, formFactor);
  const dynLaunchers = getDynamicLaunchersLocations(m);
  if (!staticLaunchers && !dynLaunchers) {
    return;
  }
  const defaultLauncher = staticLaunchers?.shift();

  const appLaunchers: CachedAppLaunchers = {
    appId,
    version,
    name,
    icon,
    description,
    tags,
    defaultLauncher,
    staticLaunchers,
    dynLaunchers,
  };
  return appLaunchers;
}

type AppVersions = Pick<AppInfo['versions'], 'current' | 'bundled' | 'packs'>;
type AppsVersions = Record<string, AppVersions>;

async function getAppVersionsFromW3N(): Promise<AppsVersions> {
  const apps: AppsVersions = {};
  for (const { id, version } of await w3n.system.apps!.opener!.listCurrentApps()) {
    apps[id] = {
      current: version,
    };
  }
  for (const { id, versions } of await w3n.system.apps!.installer!.listAllAppsPacks()) {
    const app = apps[id];
    if (app) {
      app.packs = versions;
    } else {
      apps[id] = {
        packs: versions,
      };
    }
  }
  for (const { id, version } of await w3n.system.apps!.installer!.listBundledApps()) {
    const app = apps[id];
    if (app) {
      app.bundled = version;
    } else {
      apps[id] = {
        bundled: version,
      };
    }
  }
  return apps;
}

function diffAppVersions(
  newApps: AppsVersions,
  prevApps: CachedAppVersions['apps'],
): {
  addedOrChanged: Map<string, AppVersions>;
  removed: Set<string>;
} {
  const addedOrChanged = new Map<string, AppVersions>();
  const same = new Set<string>();
  const removed = new Set<string>();
  for (const [id, appVersions] of Object.entries(newApps)) {
    const prevApp = prevApps[id];
    if (!prevApp || !areVersionsSame(prevApp.versions, appVersions)) {
      addedOrChanged.set(id, appVersions);
    } else {
      same.add(id);
    }
  }
  for (const [id] of Object.entries(newApps)) {
    if (!same.has(id) && !addedOrChanged.has(id)) {
      removed.add(id);
    }
  }
  return { addedOrChanged, removed };
}

// function areAppVersionsSame(appsVersions: AppsVersions, apps: CachedAppVersions['apps']): boolean {
//   if (Object.keys(appsVersions).length !== Object.keys(apps).length) {
//     return false;
//   }
//   for (const [ id, appVersions ] of Object.entries(appsVersions)) {
//     const appInfo = apps[id];
//     if (!appInfo) {
//       return false;
//     }
//     const { bundled, current, packs } = appInfo.versions;
//     if ((appVersions.bundled !== bundled) || (appVersions.current !== current)
//     || !deepEqual(appVersions.packs, packs)) {
//       return false;
//     }
//   }
//   return true;
// }

function areVersionsSame(a: AppVersions, b: AppVersions): boolean {
  return a.bundled === b.bundled && a.current === b.current && deepEqual(a.packs, b.packs);
}
