import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface ManifestComponent {
  runtime: string;
  services?: Record<string, { thisAppComponents?: '*' | string[] }>;
  capsRequested?: { appRPC?: string[]; shell?: Record<string, unknown> };
}

const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf-8')) as {
  components: Record<string, ManifestComponent>;
  launchers: { component: string }[];
  launchOnSystemStartup: { component: string }[];
};

const componentPaths = Object.keys(manifest.components);
const services = Object.values(manifest.components).flatMap(c => Object.entries(c.services ?? {}));

describe('manifest.json', () => {
  // Regression for plan 3.1: '/storageDenoServices.js.js' made the start of the
  // background service on system startup fail.
  it('points launchers and startup entries to existing components', () => {
    for (const { component } of [...manifest.launchers, ...manifest.launchOnSystemStartup]) {
      expect(componentPaths).toContain(component);
    }
  });

  it('requests only RPC services that are exposed, and only by allowed components', () => {
    for (const [path, component] of Object.entries(manifest.components)) {
      for (const srvName of component.capsRequested?.appRPC ?? []) {
        const service = services.find(([name]) => name === srvName);
        expect(service, `${path} requests the unknown service ${srvName}`).toBeDefined();

        const allowed = service![1].thisAppComponents;
        const isDenoItself = component.runtime === 'deno';
        if (!isDenoItself) {
          expect(allowed === '*' || allowed?.includes(path), `${path} may not call ${srvName}`).toBe(true);
        }
      }
    }
  });

  it('lists only existing components as allowed callers', () => {
    for (const [, { thisAppComponents }] of services) {
      if (Array.isArray(thisAppComponents)) {
        for (const path of thisAppComponents) {
          expect(componentPaths).toContain(path);
        }
      }
    }
  });

  // Regression for plan 3.5: the pickers run as dialogs of other apps.
  it('keeps the main service away from the file pickers', () => {
    for (const path of ['/index-file-picker.html', '/index-file-picker-mobile.html']) {
      expect(manifest.components[path].capsRequested?.appRPC).toEqual(['AppStoragePicker']);
    }
  });

  // Regression for plan 3.3: keys that are not in the platform manifest schema.
  it('has no unknown shell keys', () => {
    // ShellCAPsSetting in @types/platform-defs/manifest.d.ts
    const knownShellKeys = [
      'clipboard',
      'deviceFiles',
      'fileDialog',
      'fsResource',
      'mounts',
      'openDashboard',
      'openFile',
      'openFolder',
      'openInMountedFolder',
      'openURL',
      'scanUrlQR',
      'startAppCmds',
      'userNotifications',
    ];
    for (const component of Object.values(manifest.components)) {
      for (const key of Object.keys(component.capsRequested?.shell ?? {})) {
        expect(knownShellKeys).toContain(key);
      }
    }
  });
});
