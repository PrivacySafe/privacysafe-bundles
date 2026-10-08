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
// The app-wide state that comes from the platform: who the user is, what
// version is running, whether there is a connection, and the theme.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'vue';

/* eslint-disable @typescript-eslint/no-unused-vars */

const createBackupArchive = vi.fn(async (_opts?: unknown) => new Uint8Array([1, 2, 3]));
const t = (key: string) => key;
const cancelBackupArchive = vi.fn(async () => true);

vi.mock('@/common/services/service-provider', () => ({
  appTreasureDenoSrv: {
    createBackupArchive: (opts?: unknown) => createBackupArchive(opts),
    cancelBackupArchive: () => cancelBackupArchive(),
  },
}));

const { useAppStore } = await import('@/common/stores/app.store');
const { withSetup } = await import('../../../helpers/app-context');
const { installFakeW3n } = await import('../../../helpers/fake-w3n');

describe('app.store', () => {

  let fake: ReturnType<typeof installFakeW3n>;
  let app: App | undefined;

  function setup() {
    const res = withSetup(() => useAppStore());
    app = res.app;
    return res.result;
  }

  beforeEach(() => {
    fake = installFakeW3n({ appVersion: '0.2.3', userId: 'me@3nweb.com' });
    vi.clearAllMocks();
    document.querySelector('html')!.className = '';
  });

  afterEach(() => {
    app?.unmount();
    app = undefined;
    fake.uninstall();
  });

  describe('what it learns from the platform', () => {

    it('reads the app version', async () => {
      const store = setup();

      await store.getAppVersion();

      expect(store.appVersion).toBe('0.2.3');
    });

    it('reads the user id', async () => {
      const store = setup();

      await store.getUser();

      expect(store.user).toBe('me@3nweb.com');
    });

    it('starts out offline, before anything is known', () => {
      expect(setup().connectivityStatus).toBe('offline');
    });

    it('follows the connectivity it is told about', () => {
      const store = setup();

      store.setConnectivityStatus(true);
      expect(store.connectivityStatus).toBe('online');

      store.setConnectivityStatus(false);
      expect(store.connectivityStatus).toBe('offline');
    });

  });

  describe('the colour theme', () => {

    it('starts out dark, before the launcher has been read', () => {
      expect(setup().colorTheme).toBe('dark');
    });

    // Putting the theme on the document belongs to the library's plugin now.
    // All the store owes anyone is the current id.
    it('remembers the theme it was set to, and touches nothing else', () => {
      const store = setup();
      const htmlClassesBefore = document.querySelector('html')!.className;

      store.setColorTheme('light');
      expect(store.colorTheme).toBe('light');

      store.setColorTheme('midnight');
      expect(store.colorTheme).toBe('midnight');

      expect(document.querySelector('html')!.className).toBe(htmlClassesBefore);
    });

  });

  describe('window and loading state', () => {

    it('keeps the window size it is given', () => {
      const store = setup();

      store.setAppWindowSize({ width: 1200, height: 680 });

      expect(store.appWindowSize).toEqual({ width: 1200, height: 680 });
    });

    // Each dimension is set on its own, so a resize reporting only one of them
    // does not zero the other.
    it('leaves a dimension it was not given alone', () => {
      const store = setup();
      store.setAppWindowSize({ width: 1200, height: 680 });

      store.setAppWindowSize({ width: 800 });

      expect(store.appWindowSize).toEqual({ width: 800, height: 680 });
    });

    it('tracks the common loading flag', () => {
      const store = setup();

      store.setCommonLoading(true);
      expect(store.commonLoading).toBe(true);

      store.setCommonLoading(false);
      expect(store.commonLoading).toBe(false);
    });

    it('tracks the language', () => {
      const store = setup();

      store.setLang('en');

      expect(store.lang).toBe('en');
    });

  });

  describe('backup progress', () => {

    it('holds no progress until a backup runs', () => {
      const store = setup();

      expect(store.backupProgress).toBeNull();
      expect(store.restoreProgress).toBeNull();
    });

    it('carries the progress it is given, and clears it', () => {
      const store = setup();

      store.onBackupProgress({
        stage: 'compressing', totalFiles: 10, processedFiles: 3, percent: 30,
      });
      expect(store.backupProgress).toMatchObject({ stage: 'compressing', percent: 30 });

      // Null is what closes the progress dialog.
      store.onBackupProgress(null);
      expect(store.backupProgress).toBeNull();
    });

    it('carries restore progress separately from backup progress', () => {
      const store = setup();

      store.onRestoreProgress({
        stage: 'restoring', totalFiles: 4, processedFiles: 1, percent: 25,
      });

      expect(store.restoreProgress).toMatchObject({ stage: 'restoring' });
      expect(store.backupProgress).toBeNull();
    });

  });

  describe('saving a backup', () => {

    // The platform takes its filters inside an options object. Passing the bare
    // array - which an older signature took - reaches the platform as a call it
    // cannot serve, and it fails there with a TypeError, taking the backup with
    // it.
    it('offers the save dialog the way the platform expects', async () => {
      const store = setup();
      // As the app does on startup; the version goes into the file name.
      await store.getAppVersion();
      const writeBytes = vi.fn(async (_bytes: Uint8Array) => undefined);
      fake.saveDialogAnswering({ name: 'treasure-backup-0_2_3-2026-09-05_14-30.zip', writeBytes });

      await store.runBackupWorkflow({ t, $createNotice: vi.fn() });

      const [title, btnLabel, defaultName, opts] =
        fake.w3n.shell.fileDialogs.saveFileDialog.mock.calls[0];
      expect(typeof title).toBe('string');
      expect(typeof btnLabel).toBe('string');
      expect(defaultName).toMatch(/^treasure-backup-0_2_3-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.zip$/);
      expect(opts).toEqual({ filters: [{ name: 'ZIP Archive', extensions: ['zip'] }] });
    });

    it('writes the archive to the file the user picked', async () => {
      const store = setup();
      await store.getAppVersion();
      const writeBytes = vi.fn(async (_bytes: Uint8Array) => undefined);
      fake.saveDialogAnswering({ name: 'backup.zip', writeBytes });
      const $createNotice = vi.fn();

      await expect(store.runBackupWorkflow({ t, $createNotice })).resolves.toBe(true);

      expect(Array.from(writeBytes.mock.calls[0][0])).toEqual([1, 2, 3]);
      expect($createNotice).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
      expect(store.backupProgress).toBeNull();
    });

    // Declining the save dialog is a decision, not a failure.
    it('reports a declined save dialog as a cancellation', async () => {
      const store = setup();
      fake.saveDialogAnswering(undefined);
      const $createNotice = vi.fn();

      await expect(store.runBackupWorkflow({ t, $createNotice })).resolves.toBe(false);

      expect($createNotice).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    });

  });

  describe('cancelling a backup', () => {

    it('asks the service to stop, and tells the user', async () => {
      const store = setup();
      const $createNotice = vi.fn();
      store.onBackupProgress({
        stage: 'compressing', totalFiles: 1, processedFiles: 0, percent: 0,
      });

      await store.cancelBackup(t, $createNotice);

      expect(cancelBackupArchive).toHaveBeenCalled();
      expect($createNotice).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'warning', content: 'backup.create.cancel' }),
      );
      expect(store.backupProgress).toBeNull();
    });

    // A failure to cancel is not worth an error dialog: the user asked to stop,
    // and stopping is what they get either way.
    it('still reports a cancellation when the service fails to stop', async () => {
      cancelBackupArchive.mockRejectedValue(new Error('service is gone'));
      const store = setup();
      const $createNotice = vi.fn();
      store.onBackupProgress({
        stage: 'compressing', totalFiles: 1, processedFiles: 0, percent: 0,
      });

      await store.cancelBackup(t, $createNotice);

      expect($createNotice).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'warning' }),
      );
    });

    it('says nothing when there is no backup to cancel', async () => {
      const store = setup();
      const $createNotice = vi.fn();

      await store.cancelBackup(t, $createNotice);

      expect($createNotice).not.toHaveBeenCalled();
    });

  });

});
