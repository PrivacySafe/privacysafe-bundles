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
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@main/common/services/services-provider', () => ({
  appContactsSrvProxy: {
    getAppSettings: vi.fn(),
    saveAppSettings: vi.fn(),
  },
  initializeServices: vi.fn(),
}));

const { appContactsSrvProxy } = await import('@main/common/services/services-provider');
const { useSettingsStore } = await import('@main/common/store/settings.store');
const {
  APP_SETTINGS_DEFAULT,
  mergeAppSettings,
  sanitizeAppSettings,
} = await import('@main/common/utils/app-settings');

const srv = appContactsSrvProxy as unknown as {
  getAppSettings: ReturnType<typeof vi.fn>;
  saveAppSettings: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  setActivePinia(createPinia());
  (globalThis as unknown as Record<string, unknown>).w3n = { log: vi.fn(async () => undefined) };
});

afterEach(() => {
  vi.resetAllMocks();
  delete (globalThis as unknown as Record<string, unknown>).w3n;
});

describe('app settings values', () => {

  it('falls back to the defaults for anything unknown', () => {
    expect(sanitizeAppSettings(undefined)).toEqual(APP_SETTINGS_DEFAULT);
    expect(sanitizeAppSettings({ dateFormat: 'DD/MM/YYYY', extra: 1 })).toEqual({ dateFormat: 'MM.DD.YYYY' });
    expect(sanitizeAppSettings({ dateFormat: 'YYYY-MM-DD' })).toEqual({ dateFormat: 'YYYY-MM-DD' });
  });

  it('merges only valid fields of a patch', () => {
    const current = { dateFormat: 'DD.MM.YYYY' as const };
    expect(mergeAppSettings(current, { dateFormat: 'YYYY-MM-DD' })).toEqual({ dateFormat: 'YYYY-MM-DD' });
    expect(mergeAppSettings(current, { dateFormat: 'bad' as never })).toEqual(current);
  });

});

describe('settings store', () => {

  it('starts with the defaults', () => {
    expect(useSettingsStore().dateFormat).toBe('MM.DD.YYYY');
  });

  it('loads the stored settings', async () => {
    srv.getAppSettings.mockResolvedValue({ dateFormat: 'DD.MM.YYYY' });
    const store = useSettingsStore();

    await store.loadSettings();

    expect(store.dateFormat).toBe('DD.MM.YYYY');
  });

  it('keeps the defaults when the settings cannot be read', async () => {
    srv.getAppSettings.mockRejectedValue(new Error('no service'));
    const store = useSettingsStore();

    await store.loadSettings();

    expect(store.dateFormat).toBe('MM.DD.YYYY');
    expect(w3n.log).toHaveBeenCalled();
  });

  it('shows a change at once and saves it', async () => {
    let resolveSave: (value: unknown) => void = () => undefined;
    srv.saveAppSettings.mockReturnValue(new Promise(resolve => {
      resolveSave = resolve;
    }));
    const store = useSettingsStore();

    const saving = store.setSetting('dateFormat', 'YYYY-MM-DD');
    expect(store.dateFormat).toBe('YYYY-MM-DD');
    resolveSave({ dateFormat: 'YYYY-MM-DD' });
    await saving;

    expect(srv.saveAppSettings).toHaveBeenCalledWith({ dateFormat: 'YYYY-MM-DD' });
    expect(store.dateFormat).toBe('YYYY-MM-DD');
  });

  it('puts the previous value back when the save fails', async () => {
    srv.saveAppSettings.mockRejectedValue(new Error('disk full'));
    const store = useSettingsStore();

    await expect(store.setSetting('dateFormat', 'YYYY-MM-DD')).rejects.toThrow('disk full');

    expect(store.dateFormat).toBe('MM.DD.YYYY');
  });

  it('takes settings changed in another window', () => {
    const store = useSettingsStore();

    store.applySettings({ dateFormat: 'DD.MM.YYYY' });

    expect(store.dateFormat).toBe('DD.MM.YYYY');
  });

});
