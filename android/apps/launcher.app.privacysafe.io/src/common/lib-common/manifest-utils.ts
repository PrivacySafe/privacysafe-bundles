/*
 Copyright (C) 2021 - 2022, 2024 3NSoft Inc.

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
/* eslint-disable @typescript-eslint/no-unused-vars */
import { makeRuntimeException } from './exceptions/runtime';

export const MAIN_GUI_ENTRYPOINT = '/index.html';

export async function checkAppManifest(manifest: AppManifest, appDomain: string, version: string): Promise<void> {
  if (manifest.appDomain !== appDomain) {
    throw makeAppManifestException(
      undefined,
      {},
      {
        message: `Domain value ${manifest.appDomain} in manifest doesn't match expected value ${appDomain}`,
      },
    );
  }
  if (manifest.version !== version) {
    throw makeAppManifestException(
      manifest.appDomain,
      {},
      {
        message: `Version value ${manifest.version} in manifest doesn't match expected value ${version}`,
      },
    );
  }
  if ((manifest as GeneralAppManifest).components) {
    ensureComponentsSettings((manifest as GeneralAppManifest).components);
  }
}

function ensureComponentsSettings(components: GeneralAppManifest['components']): void {
  // XXX do an exhaustive check of components
}

export function isSimpleGUIAppManifest(m: AppManifest): boolean {
  return !(m as GeneralAppManifest).components;
}

export function getWebGUIComponent(m: AppManifest, entrypoint: string): GUIComponentDef {
  const component = getComponent(m, entrypoint) as GUIComponentDef;
  if (component.runtime !== 'web-gui') {
    throw makeAppManifestException(
      m.appDomain,
      { wrongComponentType: true },
      {
        entrypoint,
        message: `Runtime is ${component.runtime} instead of expected 'web-gui'`,
      },
    );
  }
  return component;
}

export function getComponent(m: AppManifest, entrypoint: string): AppComponent {
  if (isSimpleGUIAppManifest(m)) {
    if (entrypoint !== MAIN_GUI_ENTRYPOINT) {
      throw makeAppManifestException(m.appDomain, { componentNotFound: true }, { entrypoint });
    }
    return makeComponentForSimpleGUIApp(m);
  }

  const component = (m as GeneralAppManifest).components[entrypoint] as GUIComponentDef;
  if (!component) {
    throw makeAppManifestException(m.appDomain, { componentNotFound: true }, { entrypoint });
  }

  if (!component.icon && m.icon) {
    component.icon = m.icon;
  }

  return component;
}

function makeComponentForSimpleGUIApp(m: SimpleGUIAppManifest): GUIComponentDef {
  return {
    runtime: 'web-gui',
    capsRequested: (m as SimpleGUIAppManifest)['capsRequested'],
    windowOpts: m['windowOpts'],
    icon: m.icon,
  };
}

/**
 * Collects app's launchers that can be started directly by user.
 * @param m app's manifest
 * @param formFactor a form factor filter
 * @returns an array of launcher, or undefined if there's none defined
 */
export function getLaunchersForUser(
  m: AppManifest,
  formFactor: UserInterfaceFormFactor,
): LauncherDef[] | undefined {
  const manifestLauncher = (m as GeneralAppManifest).launchers;
  if (Array.isArray(manifestLauncher)) {
    const lst = (manifestLauncher.filter(l => !(l as DynamicLaunchers).appStorage) as LauncherDef[])
      .filter(l => l.component || l.startCmd)
      .filter(l => isApplicableToFormFactor(l, formFactor));
    return lst && lst.length > 0 ? lst : undefined;
  } else {
    return [getDefaultLauncher(m)];
  }
}

export function isApplicableToFormFactor(
  def: FormFactorSetting,
  currentFormFactor: UserInterfaceFormFactor,
): boolean {
  if (!def.formFactor) {
    return true;
  } else if (Array.isArray(def.formFactor)) {
    return !!def.formFactor.find(ff => isCompatibleFormFactor(ff, currentFormFactor));
  } else {
    return isCompatibleFormFactor(def.formFactor, currentFormFactor);
  }
}

function isCompatibleFormFactor(ff: UserInterfaceFormFactor, neededFF: UserInterfaceFormFactor): boolean {
  if (ff === neededFF) {
    return true;
  }
  switch (ff) {
    case 'phone+screen':
    case 'tablet+screen':
      return neededFF === 'desktop';
    default:
      return false;
  }
}

export function getDynamicLaunchersLocations(m: AppManifest): DynamicLaunchers[] | undefined {
  const manifestLauncher = (m as GeneralAppManifest).launchers;
  if (Array.isArray(manifestLauncher)) {
    const lst = manifestLauncher.filter(l => !!(l as DynamicLaunchers).appStorage) as DynamicLaunchers[];
    return lst && lst.length > 0 ? lst : undefined;
  } else {
    return;
  }
}

export function getDefaultLauncher(m: AppManifest): LauncherDef {
  return isSimpleGUIAppManifest(m)
    ? makeLauncherForSimpleGUIApp(m as SimpleGUIAppManifest)
    : makeLauncherForGeneralAppManifest(m as GeneralAppManifest);
}

function makeLauncherForSimpleGUIApp(m: SimpleGUIAppManifest): LauncherDef {
  return {
    component: MAIN_GUI_ENTRYPOINT,
    icon: m.icon,
    name: m.name,
    description: m.description,
  };
}

function makeLauncherForGeneralAppManifest(m: GeneralAppManifest): LauncherDef {
  if (m.launchers && m.launchers.length > 0) {
    throw makeAppManifestException(
      m.appDomain,
      {},
      {
        message: `${m.appDomain} manifest already has launcher, and one of those should be used.`,
      },
    );
  }
  if (!m.components[MAIN_GUI_ENTRYPOINT]) {
    throw makeAppManifestException(
      m.appDomain,
      {},
      {
        message: `${m.appDomain} manifest has no component '${MAIN_GUI_ENTRYPOINT}' that can be used with a default launcher.`,
      },
    );
  }
  return {
    component: MAIN_GUI_ENTRYPOINT,
    icon: m.icon,
    name: m.name,
    description: m.description,
  };
}

export function getComponentForCommand(
  m: AppManifest,
  cmd: string,
  currentFormFactor: UserInterfaceFormFactor,
): { entrypoint: string; component: GUIComponentDef } | undefined {
  if (!(m as GeneralAppManifest).components) {
    return;
  }
  for (const [entrypoint, def] of Object.entries((m as GeneralAppManifest).components)) {
    const cmdDef = (def as GUIComponentDef).startCmds?.[cmd];
    if (cmdDef && isApplicableToFormFactor(def as GUIComponentDef, currentFormFactor)) {
      return { entrypoint, component: def as GUIComponentDef };
    }
  }
  return; // explicit undefined return
}

export function getComponentForService(
  m: AppManifest,
  service: string,
  currentFormFactor: UserInterfaceFormFactor,
): { entrypoint: string; component: ServiceComponent } | undefined {
  if (!(m as GeneralAppManifest).components) {
    return;
  }
  for (const [entrypoint, def] of Object.entries((m as GeneralAppManifest).components)) {
    const srvDef = (def as ServiceComponent).services?.[service];
    if (srvDef && isApplicableToFormFactor(def as GUIServiceComponent, currentFormFactor)) {
      return { entrypoint, component: def as ServiceComponent };
    }
  }
  return; // explicit undefined return
}

export function getAllGUIComponents(
  m: AppManifest,
): { entrypoint: string; component: GUIComponentDef | GUIServiceComponent }[] {
  if (isSimpleGUIAppManifest(m)) {
    return [
      {
        entrypoint: MAIN_GUI_ENTRYPOINT,
        component: makeComponentForSimpleGUIApp(m),
      },
    ];
  }
  const lst: ReturnType<typeof getAllGUIComponents> = [];
  for (const [entrypoint, c] of Object.entries((m as GeneralAppManifest).components)) {
    if (c.runtime === 'web-gui') {
      lst.push({ entrypoint, component: c as GUIComponentDef | GUIServiceComponent });
    }
  }
  return lst;
}

export function isCallerAllowed(
  appDomain: string,
  conf: AllowedCallers,
  callerApp: string,
  callerComponent: string,
): boolean {
  if (conf && typeof conf === 'object') {
    if (appDomain === callerApp) {
      if (Array.isArray(conf.thisAppComponents)) {
        if (conf.thisAppComponents.includes(callerComponent)) {
          return true;
        }
      } else if (conf.thisAppComponents === '*') {
        return true;
      }
    } else {
      if (Array.isArray(conf.otherApps)) {
        if (conf.otherApps.includes(callerApp)) {
          return true;
        }
      } else if (conf.otherApps === '*') {
        return true;
      }
    }
  }
  return false;
}

export function isMultiInstanceComponent(c: AppComponent): boolean {
  if ((c as GUIComponentDef).multiInstances) {
    return true;
  }

  return !!(c as ServiceComponent).forOneConnectionOnly;
}

export function servicesImplementedBy(m: AppManifest, entrypoint: string): string[] | undefined {
  if (isSimpleGUIAppManifest(m)) {
    return;
  }
  const c = (m as GeneralAppManifest).components[entrypoint];
  if ((c as ServiceComponent).services) {
    const services = Object.keys((c as ServiceComponent).services);
    return services.length === 0 ? undefined : services;
  }

  return;
}

export function makeRPCException(
  appDomain: string,
  service: string,
  flags: Partial<RPCException>,
  params?: Partial<RPCException>,
): RPCException {
  if (params) {
    params.appDomain = appDomain;
    params.service = service;
  } else {
    params = { appDomain, service };
  }
  return makeRuntimeException('rpc', params, flags);
}

export function makeShellCmdException(
  appDomain: string,
  command: string,
  flags: Partial<ShellCmdException>,
  params?: Partial<ShellCmdException>,
): ShellCmdException {
  if (params) {
    params.appDomain = appDomain;
    params.command = command;
  } else {
    params = { appDomain, command };
  }
  return makeRuntimeException('shell-command', params, flags);
}

export function makeAppFSResourceException(
  resourceAppDomain: string,
  resourceName: string,
  requestingAppDomain: string,
  requestingComponent: string,
  flags: Partial<FSResourceException>,
  params?: Partial<FSResourceException>,
): FSResourceException {
  if (params) {
    params.requestingAppDomain = requestingAppDomain;
    params.requestingComponent = requestingComponent;
    params.resourceAppDomain = resourceAppDomain;
    params.resourceName = resourceName;
  } else {
    params = {
      requestingAppDomain,
      requestingComponent,
      resourceAppDomain,
      resourceName,
    };
  }
  return makeRuntimeException('fs-resource', params, flags);
}

function makeAppManifestException(
  appDomain: string | undefined,
  flags: Partial<AppManifestException>,
  params?: Partial<AppManifestException>,
): AppManifestException {
  if (params) {
    params.domain = appDomain;
  } else {
    params = { domain: appDomain };
  }
  return makeRuntimeException('app-manifest', params, flags);
}

export function hasStartupLaunchersDefined(m: AppManifest): boolean {
  const { launchOnSystemStartup } = m as GeneralAppManifest;
  return Array.isArray(launchOnSystemStartup) && launchOnSystemStartup.length > 0;
}

export function getComponentsForSystemStartup(
  m: AppManifest,
): { entrypoint: string; component: AppComponent }[] | undefined {
  const { components, launchOnSystemStartup } = m as GeneralAppManifest;
  const lst = launchOnSystemStartup
    ?.filter(c => !!c.component)
    .map(({ component: entrypoint }) => ({
      entrypoint: entrypoint!,
      component: components[entrypoint!],
    }));
  return lst && lst.length > 0 ? lst : undefined;
}

export function getExposedFSResource(
  m: AppManifest,
  resourceName: string,
  requestingApp: string,
  requestingComponent: string,
): FSResourceDescriptor {
  const { appDomain, exposedFSResources } = m as GeneralAppManifest;
  const descriptor = exposedFSResources?.[resourceName];
  if (!descriptor) {
    throw makeAppFSResourceException(appDomain, resourceName, requestingApp, requestingComponent, {
      resourceNotFound: true,
    });
  }
  if (isCallerAllowed(appDomain, descriptor.allow, requestingApp, requestingComponent)) {
    return descriptor;
  } else {
    throw makeAppFSResourceException(appDomain, resourceName, requestingApp, requestingComponent, {
      notAllowed: true,
    });
  }
}

export function isResourceInRequest(
  request: ResourcesRequest,
  appDomain: string | undefined | null,
  resource: string,
): boolean {
  const resources = !appDomain ? request.thisApp : request.otherApps?.[appDomain];
  return Array.isArray(resources) ? resources.includes(resource) : resources === resource;
}
