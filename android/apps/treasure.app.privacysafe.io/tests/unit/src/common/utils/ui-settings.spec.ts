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
*/
// The platform side of settings: the file comes from the launcher app over
// w3n.shell.getFSResource, and this app only reads it.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveTheme, SystemSettings } from '@/common/utils/ui-settings';

interface FakeFile {
  writable: boolean;
  readJSON: ReturnType<typeof vi.fn>;
  writeJSON: ReturnType<typeof vi.fn>;
  watch: ReturnType<typeof vi.fn>;
}

const SETTINGS = {
  lang: 'en',
  colorTheme: 'dark2',
  systemFoldersDisplaying: true,
  allowShowingDevtool: false,
};

// The launcher renamed its theme ids, but the settings file of an already
// installed system keeps whatever was written into it before the rename.
describe('getActiveTheme', () => {

  it('maps the ids that were retired', () => {
    expect(getActiveTheme('default')).toBe('light');
    expect(getActiveTheme('dark1')).toBe('dark');
    expect(getActiveTheme('dark2')).toBe('dark');
  });

  it('leaves a current id alone', () => {
    expect(getActiveTheme('light')).toBe('light');
    expect(getActiveTheme('dark')).toBe('dark');
    expect(getActiveTheme('midnight')).toBe('midnight');
  });

});

describe('SystemSettings', () => {

  let file: FakeFile;
  let getFSResource: ReturnType<typeof vi.fn>;
  let watchers: { next?: (event: { type: string }) => Promise<void> }[];

  beforeEach(() => {
    watchers = [];
    file = {
      writable: false,
      readJSON: vi.fn(async () => ({ ...SETTINGS })),
      writeJSON: vi.fn(async () => undefined),
      watch: vi.fn((obs: any) => {
        watchers.push(obs);
        return () => {
          const i = watchers.indexOf(obs);
          if (i >= 0) {
            watchers.splice(i, 1);
          }
        };
      }),
    };
    getFSResource = vi.fn(async () => file);
    (globalThis as any).w3n = { shell: { getFSResource } };
  });

  afterEach(() => {
    delete (globalThis as any).w3n;
  });

  // Named explicitly, because the resource is owned by the launcher and this
  // app is only granted a read of it.
  it('asks the launcher app for the ui-settings resource', async () => {
    await SystemSettings.makeResourceReader();

    expect(getFSResource).toHaveBeenCalledWith('launcher.app.privacysafe.io', 'ui-settings');
  });

  it('reads the whole settings file', async () => {
    const settings = await SystemSettings.makeResourceReader();

    await expect(settings.getAll()).resolves.toEqual(SETTINGS);
  });

  it('reads single settings out of the file', async () => {
    const settings = await SystemSettings.makeResourceReader();

    await expect(settings.getCurrentLanguage()).resolves.toBe('en');
    // 'dark2' is what the file still says; 'dark' is what it means now.
    await expect(settings.getCurrentColorTheme()).resolves.toBe('dark');
  });

  // A reader has no business writing the launcher's file, and saying so is
  // better than a failed write further down.
  it('refuses to save through a read-only resource', async () => {
    const settings = await SystemSettings.makeResourceReader();

    await expect((settings as any).saveSettingsFile({ lang: 'en' }))
    .rejects.toThrow(/can only read/);
    expect(file.writeJSON).not.toHaveBeenCalled();
  });

  describe('watchConfig', () => {

    it('reports the settings again on a change of the file', async () => {
      const settings = await SystemSettings.makeResourceReader();
      const next = vi.fn();

      settings.watchConfig({ next });
      await watchers[0].next!({ type: 'file-change' });

      expect(next).toHaveBeenCalledWith(SETTINGS);
    });

    // The platform reports removals and other events on the same channel.
    it('says nothing about an event that is not a change', async () => {
      const settings = await SystemSettings.makeResourceReader();
      const next = vi.fn();

      settings.watchConfig({ next });
      await watchers[0].next!({ type: 'removed' });

      expect(next).not.toHaveBeenCalled();
    });

    it('stops watching when the returned function is called', async () => {
      const settings = await SystemSettings.makeResourceReader();

      const stop = settings.watchConfig({ next: vi.fn() });
      expect(watchers).toHaveLength(1);

      stop();
      expect(watchers).toHaveLength(0);
    });

    it('passes a fresh read on, not the settings it started with', async () => {
      const settings = await SystemSettings.makeResourceReader();
      const next = vi.fn();
      settings.watchConfig({ next });

      file.readJSON.mockResolvedValue({ ...SETTINGS, colorTheme: 'light' });
      await watchers[0].next!({ type: 'file-change' });

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ colorTheme: 'light' }));
    });

  });

});
