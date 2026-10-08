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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSystemLevelAppConfig } from '@main/common/store/app/system-level-app-config';
import { installFakeW3n } from '../../../helpers/fake-w3n.ts';

const htmlClasses = () => Array.from(document.documentElement.classList);

let platform: ReturnType<typeof installFakeW3n>;

beforeEach(() => {
  document.documentElement.className = '';
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('URL', Object.assign(Object.create(URL), URL, {
    createObjectURL: vi.fn(() => 'blob:fake-logo'),
  }));
});

afterEach(() => {
  platform?.uninstall();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useSystemLevelAppConfig', () => {

  it('starts with the defaults before initialize is called', () => {
    platform = installFakeW3n();
    const config = useSystemLevelAppConfig();

    expect(config.appVersion.value).toBe('');
    expect(config.user.value).toBe('');
    expect(config.lang.value).toBe('en');
    expect(config.colorTheme.value).toBe('dark');
    expect(config.customLogoSrc.value).toBeUndefined();
  });

  it('reads the app version and the user address on initialize', async () => {
    platform = installFakeW3n({ appVersion: '0.8.30', userId: 'ann@3nweb.com' });
    const config = useSystemLevelAppConfig();

    await config.initialize();

    expect(config.appVersion.value).toBe('0.8.30');
    expect(config.user.value).toBe('ann@3nweb.com');
  });

  it('takes the language and the theme from the launcher settings', async () => {
    platform = installFakeW3n({ settings: { lang: 'en', colorTheme: 'light' } });
    const config = useSystemLevelAppConfig();

    await config.initialize();

    expect(config.colorTheme.value).toBe('light');
  });

  // The launcher still stores the theme ids of the old palette, so they have to
  // be mapped onto the ones the library knows.
  it('maps the legacy theme ids of the launcher settings', async () => {
    platform = installFakeW3n({ settings: { colorTheme: 'dark2' } });
    const config = useSystemLevelAppConfig();

    await config.initialize();

    expect(config.colorTheme.value).toBe('dark');
  });

  // Since the theme plugin of the library owns the classes on <html>, the store
  // only holds the value and must not touch the DOM itself - otherwise the two
  // fight over which palette is applied.
  it('leaves the html classes to the theme plugin', async () => {
    platform = installFakeW3n({ settings: { colorTheme: 'light' } });
    const config = useSystemLevelAppConfig();

    await config.initialize();

    expect(config.colorTheme.value).toBe('light');
    expect(htmlClasses()).toEqual([]);
  });

  it('turns a custom logo data url into an object url', async () => {
    platform = installFakeW3n({
      settings: { customLogo: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' },
    });
    const config = useSystemLevelAppConfig();

    await config.initialize();

    expect(config.customLogoSrc.value).toBe('blob:fake-logo');
  });

  // A malformed logo must not take the whole app start down with it: the logo is
  // decoration, while initialize() also brings in the user address.
  it('survives a malformed custom logo', async () => {
    platform = installFakeW3n({ settings: { customLogo: 'not-a-data-url' } });
    const config = useSystemLevelAppConfig();

    await expect(config.initialize()).resolves.toBeUndefined();

    expect(config.customLogoSrc.value).toBeUndefined();
    expect(config.user.value).toBe('me@3nweb.com');
  });

  it('leaves no logo when the settings carry none', async () => {
    platform = installFakeW3n({ settings: { customLogo: undefined } });
    const config = useSystemLevelAppConfig();

    await config.initialize();

    expect(config.customLogoSrc.value).toBeUndefined();
  });

  // The config resource lives in the launcher app. If it cannot be read, this
  // app still has to start — it just keeps the default theme and language.
  it('still initializes when the settings resource cannot be read', async () => {
    platform = installFakeW3n({ appVersion: '0.8.30' });
    platform.w3n.shell.getFSResource.mockRejectedValue(new Error('no resource'));
    const config = useSystemLevelAppConfig();

    await expect(config.initialize()).resolves.toBeUndefined();

    expect(config.appVersion.value).toBe('0.8.30');
    expect(config.colorTheme.value).toBe('dark');
  });

  // watchConfig wraps the observer: what reaches file.watch reacts to a
  // 'file-change' FS event and then RE-READS the file, rather than receiving the
  // new config directly. So the stored settings have to change too, or the
  // re-read hands back the old ones.
  it('follows a later change of the settings', async () => {
    platform = installFakeW3n({ settings: { colorTheme: 'dark2' } });
    let onFsEvent: ((e: { type: string }) => Promise<void>) | undefined;
    platform.settingsFile.watch.mockImplementation((obs: {
      next?: (e: { type: string }) => Promise<void>;
    }) => {
      onFsEvent = obs.next;
      return () => undefined;
    });
    const config = useSystemLevelAppConfig();
    await config.initialize();
    expect(config.colorTheme.value).toBe('dark');

    platform.settingsFile.readJSON.mockResolvedValue({
      lang: 'en', colorTheme: 'light', systemFoldersDisplaying: true,
      allowShowingDevtool: false,
    });
    await onFsEvent!({ type: 'file-change' });

    expect(config.colorTheme.value).toBe('light');
  });

  it('ignores FS events other than a file change', async () => {
    platform = installFakeW3n({ settings: { colorTheme: 'dark2' } });
    let onFsEvent: ((e: { type: string }) => Promise<void>) | undefined;
    platform.settingsFile.watch.mockImplementation((obs: {
      next?: (e: { type: string }) => Promise<void>;
    }) => {
      onFsEvent = obs.next;
      return () => undefined;
    });
    const config = useSystemLevelAppConfig();
    await config.initialize();

    platform.settingsFile.readJSON.mockResolvedValue({
      lang: 'en', colorTheme: 'light', systemFoldersDisplaying: true,
      allowShowingDevtool: false,
    });
    await onFsEvent!({ type: 'removed' });

    expect(config.colorTheme.value).toBe('dark');
  });

  it('unsubscribes from the settings on stopWatching', async () => {
    platform = installFakeW3n();
    const unsub = vi.fn();
    platform.settingsFile.watch.mockReturnValue(unsub);
    const config = useSystemLevelAppConfig();
    await config.initialize();

    await config.stopWatching();

    expect(unsub).toHaveBeenCalled();
  });

  it('tolerates stopWatching before initialize', async () => {
    platform = installFakeW3n();
    const config = useSystemLevelAppConfig();

    await expect(config.stopWatching()).resolves.toBeUndefined();
  });

});
