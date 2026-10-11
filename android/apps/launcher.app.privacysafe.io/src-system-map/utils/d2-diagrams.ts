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

import { D2 } from '@terrastruct/d2';
import { copy as copyJSON } from '@/common/lib-common/json-utils';

export function toDataForDiagram(apps: AppData[]): DiagramAppData[] {
  const data = copyJSON(apps as DiagramAppData[]);
  let appCounter = 1;
  for (const app of data) {
    app.diagramId = `app${appCounter}`;
    appCounter += 1;
    setDiagramIdsInside(app);
  }

  for (const app of data) {
    app.connections = {
      inThisApp: connectionsInTheApp(app),
      toOtherApps: connectionsToOtherApps(app, data),
      toPlatform: connectionsToPlatform(app),
    };
  }
  console.log(data);
  return data;
}

function setDiagramIdsInside(app: DiagramAppData): void {
  let componentCounter = 1;
  for (const component of app.components) {
    component.diagramId = `comp${componentCounter}`;
    componentCounter += 1;
  }
  let serviceCounter = 1;
  for (const srv of app.services) {
    srv.diagramId = `srv${serviceCounter}`;
    serviceCounter += 1;
  }
  let cmdsCounter = 1;
  for (const cmd of app.startCmds) {
    cmd.diagramId = `cmd${cmdsCounter}`;
    cmdsCounter += 1;
  }
}

function connectionsInTheApp(app: DiagramAppData): ConnectionInApp[] {
  return [
    ...makeServiceImplConnectionsIn(app),
    ...makeCommandImplConnectionsIn(app),
    ...makeCommandCallConnectionsIn(app),
    ...makeServiceCallConnectionsIn(app),
  ];
}

function makeServiceImplConnectionsIn(app: DiagramAppData): ConnectionInApp[] {
  return app.services.map<ConnectionInApp>(srv => {
    const implComponent = app.components.find(({ entrypoint }) => entrypoint === srv.implComponent);
    return {
      type: 'service-impl',
      srv: srv.diagramId,
      srvName: srv.service,
      comp: implComponent!.diagramId,
    };
  });
}

function makeCommandImplConnectionsIn(app: DiagramAppData): ConnectionInApp[] {
  return app.startCmds.map<ConnectionInApp>(cmd => {
    const implComponent = app.components.find(({ entrypoint }) => entrypoint === cmd.implComponent);
    return {
      type: 'command-impl',
      cmd: cmd.diagramId,
      cmdName: cmd.cmd,
      comp: implComponent!.diagramId,
    };
  });
}

function makeCommandCallConnectionsIn(app: DiagramAppData): ConnectionInApp[] {
  return collectCommandCallsInside(app).map<ConnectionInApp>(({ callingComp, cmdName }) => ({
    type: 'command-call',
    cmdName,
    cmd: findCmdIn(app, cmdName)?.diagramId,
    comp: callingComp.diagramId,
  }));
}

function makeServiceCallConnectionsIn(app: DiagramAppData): ConnectionInApp[] {
  return collectServiceCallsInside(app).map<ConnectionInApp>(({ callingComp, srvName }) => ({
    type: 'service-call',
    comp: callingComp.diagramId,
    srvName,
    srv: findServiceIn(app, srvName)?.diagramId,
  }));
}

function findCmdIn(app: DiagramAppData, cmdName: string): AppCmd | undefined {
  return app.startCmds.find(({ cmd }) => cmd === cmdName);
}

function findServiceIn(app: DiagramAppData, srvName: string): AppService | undefined {
  return app.services.find(({ service }) => service === srvName);
}

function collectCommandCallsInside(app: DiagramAppData): {
  callingComp: DiagramAppComponentData;
  cmdName: string;
}[] {
  return app.components
    .map(callingComp => {
      const cmds = callingComp.caps?.shell?.startAppCmds?.thisApp;
      if (!cmds || cmds.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return undefined as any;
      }

      if (Array.isArray(cmds)) {
        return cmds.map(cmdName => ({ callingComp, cmdName }));
      }

      return { callingComp, cmdName: cmds };
    })
    .filter(c => !!c)
    .flatMap(c => c);
}

function collectServiceCallsInside(app: DiagramAppData): {
  callingComp: DiagramAppComponentData;
  srvName: string;
}[] {
  return app.components
    .map(callingComp => {
      const services = callingComp.caps?.appRPC;
      if (!services || services.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return undefined as any;
      }

      return services.map(srvName => ({ callingComp, srvName }));
    })
    .filter(c => !!c)
    .flatMap(c => c);
}

function connectionsToOtherApps(callerApp: DiagramAppData, apps: DiagramAppData[]): ConnectionToOtherApp[] {
  return [
    ...makeCommandCallConnectionsBetweenApps(callerApp, apps),
    ...makeServiceCallConnectionsBetweenApps(callerApp, apps),
  ];
}

function makeCommandCallConnectionsBetweenApps(
  callerApp: DiagramAppData,
  apps: DiagramAppData[],
): ConnectionToOtherApp[] {
  return collectCommandCallsBetweenApps(callerApp, apps).map<ConnectionToOtherApp>(
    ({ appWithCmd, appId, cmdName, callingComp }) => {
      const cmd = appWithCmd ? findCmdIn(appWithCmd, cmdName) : undefined;
      return {
        type: 'command-call',
        appId,
        cmdName,
        cmd: cmd ? `${appWithCmd!.diagramId}.${cmd.diagramId}` : undefined,
        callerApp: callerApp.diagramId,
        comp: `${callerApp.diagramId}.${callingComp.diagramId}`,
      };
    },
  );
}

function collectCommandCallsBetweenApps(
  callerApp: DiagramAppData,
  apps: DiagramAppData[],
): {
  callingComp: DiagramAppComponentData;
  appWithCmd?: DiagramAppData;
  appId: string;
  cmdName: string;
}[] {
  return callerApp.components
    .map(callingComp => {
      const appsWithCmds = callingComp.caps?.shell?.startAppCmds?.otherApps;
      if (!appsWithCmds) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return undefined as any;
      }
      return Object.entries(appsWithCmds)
        .map(([appId, cmds]) => {
          const appWithCmd = apps.find(({ id }) => id === appId);
          if (Array.isArray(cmds)) {
            return cmds.map(cmdName => ({ callingComp, appWithCmd, appId, cmdName }));
          }

          return { callingComp, appWithCmd, appId, cmdName: cmds };
        })
        .flatMap(c => c);
    })
    .filter(c => !!c)
    .flatMap(c => c);
}

function makeServiceCallConnectionsBetweenApps(
  callerApp: DiagramAppData,
  apps: DiagramAppData[],
): ConnectionToOtherApp[] {
  return collectServiceCallsBetweenApps(callerApp, apps).map<ConnectionToOtherApp>(
    ({ appWithSrv, appId, srvName, callingComp }) => {
      const srv = appWithSrv ? findServiceIn(appWithSrv, srvName) : undefined;
      return {
        type: 'service-call',
        appId,
        srvName,
        srv: srv ? `${appWithSrv!.diagramId}.${srv.diagramId}` : undefined,
        callerApp: callerApp.diagramId,
        comp: `${callerApp.diagramId}.${callingComp.diagramId}`,
      };
    },
  );
}

function collectServiceCallsBetweenApps(
  callerApp: DiagramAppData,
  apps: DiagramAppData[],
): {
  callingComp: DiagramAppComponentData;
  appWithSrv?: DiagramAppData;
  appId: string;
  srvName: string;
}[] {
  return callerApp.components
    .map(callingComp => {
      const appsWithCmds = callingComp.caps?.otherAppsRPC;
      if (!appsWithCmds) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return undefined as any;
      }

      return appsWithCmds.map(({ app: appId, service: srvName }) => {
        const appWithSrv = apps.find(({ id }) => id === appId);
        return { callingComp, appWithSrv, appId, srvName };
      });
    })
    .filter(c => !!c)
    .flatMap(c => c);
}

function connectionsToPlatform(app: DiagramAppData): ConnectionToPlatform[] {
  return app.components
    .filter(({ caps }) => !!caps)
    .map(({ caps, diagramId }) => {
      const comp = `${app.diagramId}.${diagramId}`;
      const connections: ConnectionToPlatform[] = [];
      if (caps?.keyrings) {
        connections.push({ capType: 'keyring', comp });
      }

      if (caps?.storage?.userFS) {
        connections.push({ capType: 'user-storage', comp });
      }

      if (caps?.mail?.sendingTo || caps?.mail?.receivingFrom) {
        connections.push({ capType: 'asmail', comp });
      } else if (caps?.mail?.preflightsTo) {
        connections.push({ capType: 'asmail-preflight', comp });
      }

      return connections;
    })
    .flatMap(c => c);
}

function d2ForApp(app: DiagramAppData): string {
  const labelLine = `
  label: "${app.name} (v.${app.version})"
  `;
  return `
  ${app.diagramId}: {${
    app.iconBlobURL
      ? `
    label: ""
    logo: {
      shape: image
      icon: ${app.iconBlobURL}
      height: 64
      ${labelLine}
    }`
      : labelLine
  }
    style.font-size: 24${
      app.components.map(d2ForComponent).join('\n') +
      app.services.map(d2ForService).join('\n') +
      app.startCmds.map(d2ForStartCmd).join('\n') +
      app.connections.inThisApp.map(d2ForInAppConnection).join('\n')
    }
  }
  `;
}

function d2ForApps(apps: DiagramAppData[]): string {
  return apps.map(d2ForApp).join('');
}

function d2ForComponent(component: DiagramAppComponentData): string {
  return `
    ${component.diagramId}: {
      label: "${component.entrypoint}"
      shape: ${component.runtime === 'web-gui' ? 'page' : 'rectangle'}
      style.font-size: 16
    }
  `;
}

function d2ForService(srv: AppService): string {
  return `
    ${srv.diagramId}: {
      label: "${srv.service}"
      shape: hexagon
      style.font-size: 16
    }
  `;
}

function d2ForStartCmd(cmd: AppCmd): string {
  return `
    ${cmd.diagramId}: {
      label: "${cmd.cmd}"
      shape: step
      style.font-size: 16
    }
  `;
}

function d2ForInAppConnection(conn: ConnectionInApp): string {
  switch (conn.type) {
    case 'service-impl': {
      return `
        ${conn.srv} <-> ${conn.comp}: {
          source-arrowhead.shape: circle
          target-arrowhead.shape: circle
        }
      `;
    }

    case 'service-call': {
      if (conn.srv) {
        return `${conn.comp} -> ${conn.srv}`;
      }

      const missing = generateMissingElement(`X missing ${conn.srvName}`);
      return missing.shape + `${conn.comp} -> ${missing.diagramId}`;
    }

    case 'command-impl': {
      return `${conn.cmd} -> ${conn.comp}`;
    }

    case 'command-call': {
      if (conn.cmd) {
        return `${conn.comp} -> ${conn.cmd}`;
      }

      const missing = generateMissingElement(`X missing ${conn.cmdName}`);
      return `${conn.comp} -> ${missing.diagramId}`;
    }

    // no default
  }
}

let missingElementCounter = 1;
function generateMissingElement(label: string): { shape: string; diagramId: string } {
  const diagramId = `missing${missingElementCounter}`;
  missingElementCounter += 1;
  const shape = `
    ${diagramId}: {
      label: "${label}"
      shape: diamond
    }
  `;
  return { diagramId, shape };
}

function d2ForConnectionToOtherApp(conn: ConnectionToOtherApp): string {
  switch (conn.type) {
    case 'service-call': {
      if (conn.srv) {
        return `${conn.comp} -> ${conn.srv}`;
      }

      const missing = generateMissingElement(`X missing ${conn.srvName} from app ${conn.appId}`);
      return missing.shape + `${conn.comp} -> ${missing.diagramId}`;
    }

    case 'command-call': {
      if (conn.cmd) {
        return `${conn.comp} -> ${conn.cmd}`;
      }

      const missing = generateMissingElement(`X missing ${conn.cmdName} from app ${conn.appId}`);
      return `${conn.comp} -> ${missing.diagramId}`;
    }

    // no default
  }
}

function d2ForExternalConnectionsOf(apps: DiagramAppData[]): string {
  return apps
    .map(app => app.connections.toOtherApps.map(d2ForConnectionToOtherApp))
    .flatMap(c => c)
    .join('\n');
}

function d2ForPlatformAndCapsConnections(apps: DiagramAppData[]): string {
  return (
    `
  platform: {
    label: ""
    logo: {
      shape: image
      icon: /logo.png
      height: 64
      label: "PrivacySafe platform"
    }
    style: {
      font-size: 24
      border-radius: 8
    }

    asmail: {
      label: ASMail
      style.border-radius: 999
    }

    user-storage: {
      label: "File Storage"
      style.border-radius: 999
    }

    keyring: {
      label: Keyrings
      style.border-radius: 999
    }
  }
  ` + apps.map(app => app.connections.toPlatform.map(d2ForCapConnection).join('\n')).join('\n')
  );
}

function d2ForCapConnection({ capType, comp }: ConnectionToPlatform): string {
  switch (capType) {
    case 'asmail':
      return `${comp} <-> platform.asmail : sends messages`;

    case 'asmail-preflight':
      return `${comp} -> platform.asmail : checks addresses`;

    case 'keyring':
      return `${comp} -> platform.keyring`;

    case 'user-storage':
      return `${comp} <-> platform.user-storage`;

    // no default
  }
}

const d2 = new D2();

export interface RenderingOpts {
  direction: 'right' | 'down';
  theme?: {
    themeID: number;
    darkThemeID: number;
    sketch?: boolean;
  };
}

export async function svgWithApps(apps: DiagramAppData[], opts: RenderingOpts): Promise<string> {
  const src =
    `
  vars: {
    d2-config: {
      layout-engine: elk
    }
  }
  direction: ${opts.direction}
  ` +
    d2ForApps(apps) +
    d2ForExternalConnectionsOf(apps) +
    d2ForPlatformAndCapsConnections(apps);

  const compiled = await d2.compile(src);
  compiled.renderOptions.pad = 10;
  if (opts.theme) {
    const { sketch, themeID, darkThemeID } = opts.theme;
    compiled.renderOptions.sketch = sketch;
    compiled.renderOptions.themeID = themeID;
    compiled.renderOptions.darkThemeID = darkThemeID;
  }

  const svg = await d2.render(compiled.diagram, compiled.renderOptions);
  return svg;
}
