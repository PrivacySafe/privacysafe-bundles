/*
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
*/
import { copy as copyJSON } from '@/common/lib-common/json-utils';
import {
  isApplicableToFormFactor,
  isSimpleGUIAppManifest,
  MAIN_GUI_ENTRYPOINT,
} from '@/common/lib-common/manifest-utils';
import { mimeTypeOfImageFile } from '@/common/utils/image-files';

export async function fetchData(interimValue: (apps: AppData[]) => Promise<void>): Promise<AppData[]> {
  const apps: AppData[] = [];
  const lstOfInstalled = await w3n.system.apps!.opener!.listCurrentApps();

  for (const { id } of lstOfInstalled) {
    const m = await w3n.system.apps!.opener!.getAppManifestOfCurrent(id);
    if (!m) {
      continue;
    }

    const iconBlobURL = await w3n.system.apps!.opener!.getAppFileBytesOfCurrent!(id, m.icon)
      .then(iconBytes =>
        iconBytes
          ? URL.createObjectURL(new Blob([iconBytes as BlobPart], { type: mimeTypeOfImageFile(m.icon) }))
          : undefined,
      )
      .catch(err => {
        console.error(`Failed to get icon file ${m.icon} for app ${m.appDomain}, with error:`, err);
        return undefined;
      });

    const app: AppData = {
      id: m.appDomain,
      name: m.name,
      version: m.version,
      iconBlobURL,
      components: [],
      services: [],
      startCmds: [],
      exposedFSResources: [],
    };

    if (isSimpleGUIAppManifest(m)) {
      const { capsRequested } = m as web3n.caps.SimpleGUIAppManifest;
      app.components.push({
        entrypoint: MAIN_GUI_ENTRYPOINT,
        runtime: 'web-gui',
        caps: capsRequested,
      });
    } else {
      for (const [entrypoint, component] of Object.entries((m as web3n.caps.GeneralAppManifest).components)) {
        const componentData: AppComponentData = {
          entrypoint,
          runtime: component.runtime,
          caps: component.capsRequested,
          formFactor: (component as web3n.caps.GUIComponent).formFactor,
        };
        const services = (component as web3n.caps.ServiceComponent).services;
        if (services) {
          for (const [service, allowedCallers] of Object.entries(services)) {
            app.services.push({
              service,
              allowedCallers,
              implComponent: entrypoint,
            });
          }
        }
        const cmds = (component as web3n.caps.GUIComponent).startCmds;
        if (cmds) {
          for (const [cmd, allowedCallers] of Object.entries(cmds)) {
            app.startCmds.push({
              cmd,
              allowedCallers,
              implComponent: entrypoint,
            });
          }
        }
        app.components.push(componentData);
      }
    }
    apps.push(app);

    if (apps.length < lstOfInstalled.length) {
      await interimValue(copyJSON(apps));
    }
  }

  return apps;
}

export function filterForFormFactor(ff: 'desktop' | 'phone', apps: AppData[]): AppData[] {
  const ffApplicable: AppData[] = [];
  for (const app of apps) {
    const appCopy = copyJSON(app);
    for (let i = 0; i < appCopy.components.length; i += 1) {
      const component = appCopy.components[i];
      if (isApplicableToFormFactor(component, ff)) {
        continue;
      }

      appCopy.components.splice(i, 1);
      i -= 1;
    }

    if (appCopy.components.length === 0) {
      continue;
    }

    ffApplicable.push(appCopy);

    appCopy.services = appCopy.services.filter(({ implComponent }) =>
      appCopy.components.find(({ entrypoint }) => entrypoint === implComponent),
    );

    appCopy.startCmds = appCopy.startCmds.filter(({ implComponent }) =>
      appCopy.components.find(({ entrypoint }) => entrypoint === implComponent),
    );
  }

  return ffApplicable;
}
