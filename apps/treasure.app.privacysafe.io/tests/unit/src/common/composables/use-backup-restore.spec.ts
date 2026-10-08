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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import type { App, Plugin } from 'vue';

/* eslint-disable @typescript-eslint/no-unused-vars */
const restoreBackupArchive = vi.fn(async (_bytes: Uint8Array) => true);
const getAllGroups = vi.fn(async () => undefined);
const getAllRecords = vi.fn(async () => undefined);
const loadRecentRecords = vi.fn(async () => undefined);

vi.mock('@/common/services/service-provider', () => ({
  appTreasureDenoSrv: {
    restoreBackupArchive: (bytes: Uint8Array) => restoreBackupArchive(bytes),
  },
}));

vi.mock('@/common/stores/record.store', () => ({
  useRecordStore: () => ({ getAllGroups, getAllRecords, loadRecentRecords }),
}));

const { DIALOGS_KEY, NOTIFICATIONS_KEY } = await import('@v1nt1248/3nclient-lib/plugins');
const { useBackupRestore } = await import('@/common/composables/use-backup-restore');
const { packEncryptedContainer } = await import('@/common/utils/backup-container');
const { makeBackupMetadataBytes, METADATA_FILE_NAME, PAYLOAD_FILE_NAME } =
  await import('@shared/utils/backup-archive');
const { GROUPS_FILE_NAME } = await import('@shared/constants');
const { withSetup } = await import('../../../helpers/app-context');
const { installFakeW3n } = await import('../../../helpers/fake-w3n');

const APP_VERSION = '0.2.3';

// Deriving a key runs 250k PBKDF2 rounds, which the default timeout dislikes.
const TIMEOUT = 30000;

function utf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** The archive the service packs, with no metadata of its own. */
const INNER = zipSync({
  [GROUPS_FILE_NAME]: utf8('[]'),
  'rec-1': utf8('{"id":"rec-1"}'),
});

/** An unencrypted backup file, as this build writes one. */
function plainArchive(): Uint8Array {
  return zipSync({
    [GROUPS_FILE_NAME]: utf8('[]'),
    'rec-1': utf8('{"id":"rec-1"}'),
    [METADATA_FILE_NAME]: makeBackupMetadataBytes({
      version: APP_VERSION, recordsCount: 1, groupsCount: 0,
    }),
  });
}

/** A dialog call, as the composable made it. */
interface OpenedDialog {
  props: Record<string, unknown>;
  dialogProps: Record<string, unknown>;
}

describe('useBackupRestore', () => {

  let fake: ReturnType<typeof installFakeW3n>;
  let app: App | undefined;
  let opened: OpenedDialog[];
  let answers: { event: string; data?: unknown }[];
  let $createNotice: ReturnType<typeof vi.fn>;

  function pluginsProviding(): Plugin[] {
    const $openDialog = vi.fn(async (_component: unknown, props: Record<string, unknown>) => {
      opened.push({
        props,
        dialogProps: (props.dialogProps ?? {}) as Record<string, unknown>,
      });
      return answers.shift() ?? { event: 'cancel' };
    });

    return [{
      install(vueApp: App) {
        // Cast because these stand-ins answer plain strings where the plugins
        // declare their own event unions; the composable only ever compares.
        vueApp.provide(DIALOGS_KEY, { $openDialog } as never);
        vueApp.provide(NOTIFICATIONS_KEY, { $createNotice } as never);
      },
    }];
  }

  function setup() {
    const res = withSetup(() => useBackupRestore(), { plugins: pluginsProviding() });
    app = res.app;
    return res.result;
  }

  beforeEach(() => {
    fake = installFakeW3n({ appVersion: APP_VERSION });
    opened = [];
    answers = [];
    $createNotice = vi.fn();
    restoreBackupArchive.mockClear();
    restoreBackupArchive.mockResolvedValue(true);
    getAllRecords.mockClear();
  });

  afterEach(() => {
    app?.unmount();
    app = undefined;
    fake.uninstall();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does nothing when no file is picked', async () => {
    fake.openDialogAnswering(null);

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(false);
    expect(restoreBackupArchive).not.toHaveBeenCalled();
  });

  // The platform takes its filters inside an options object. Passing the bare
  // array - which an older signature took - reaches the platform as a call it
  // cannot serve, and the save dialog fails with a TypeError from inside it.
  it('asks the platform for a file the way the platform expects', async () => {
    fake.openDialogAnswering(plainArchive());
    answers = [{ event: 'confirm' }];

    const { runRestoreWorkflow } = setup();
    await runRestoreWorkflow();

    const [title, btnLabel, multiSelections, opts] =
      fake.w3n.shell.fileDialogs.openFileDialog.mock.calls[0];
    expect(typeof title).toBe('string');
    expect(typeof btnLabel).toBe('string');
    expect(multiSelections).toBe(false);
    expect(opts).toEqual({ filters: [{ name: 'ZIP Archive', extensions: ['zip'] }] });
  });

  it('restores an unencrypted archive once the user confirms', async () => {
    fake.openDialogAnswering(plainArchive());
    answers = [{ event: 'confirm' }];

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(true);
    expect(restoreBackupArchive).toHaveBeenCalledTimes(1);
    expect(getAllRecords).toHaveBeenCalled();
    expect($createNotice).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('does not restore when the confirmation is declined', async () => {
    fake.openDialogAnswering(plainArchive());
    answers = [{ event: 'cancel' }];

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(false);
    expect(restoreBackupArchive).not.toHaveBeenCalled();
  });

  // The passphrase is used here, in the window: the service is handed the
  // archive already decrypted, and never sees the passphrase at all.
  it('asks for a passphrase, and decrypts before reaching the service', async () => {
    fake.openDialogAnswering(await packEncryptedContainer(INNER, 'the passphrase', APP_VERSION));
    answers = [
      { event: 'confirm', data: 'the passphrase' },
      { event: 'confirm' },
    ];

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(true);
    expect(opened[0].props.mode).toBe('open');

    const [restoredBytes] = restoreBackupArchive.mock.calls[0];
    expect(Array.from(restoredBytes)).toEqual(Array.from(INNER));
  }, TIMEOUT);

  // A mistyped passphrase is a slip; the whole flow should not have to restart.
  it('asks again after a wrong passphrase, and marks the dialog as such', async () => {
    fake.openDialogAnswering(await packEncryptedContainer(INNER, 'right one', APP_VERSION));
    answers = [
      { event: 'confirm', data: 'wrong one' },
      { event: 'confirm', data: 'right one' },
      { event: 'confirm' },
    ];

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(true);
    expect(opened[0].props.wrongPassphrase).toBeFalsy();
    expect(opened[1].props.wrongPassphrase).toBe(true);

    const [restoredBytes] = restoreBackupArchive.mock.calls[0];
    expect(Array.from(restoredBytes)).toEqual(Array.from(INNER));
  }, TIMEOUT);

  it('gives up when the user backs out of the passphrase dialog', async () => {
    fake.openDialogAnswering(await packEncryptedContainer(INNER, 'the passphrase', APP_VERSION));
    answers = [{ event: 'cancel' }];

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(false);
    expect(restoreBackupArchive).not.toHaveBeenCalled();
  }, TIMEOUT);

  it('reports a file that is not an archive, without restoring', async () => {
    fake.openDialogAnswering(new Uint8Array([1, 2, 3, 4]));

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(false);
    expect($createNotice).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(restoreBackupArchive).not.toHaveBeenCalled();
    expect(opened).toHaveLength(0);
  });

  // Another app's backup unpacks and its entries can look restorable, so it has
  // to be named as foreign - and before the user is asked for anything.
  it('refuses a backup of another app without asking for a passphrase', async () => {
    fake.openDialogAnswering(zipSync({
      'contacts_app_privacysafe_io.json': utf8('{"version":"0.8.34"}'),
      [PAYLOAD_FILE_NAME]: new Uint8Array([9, 9, 9]),
    }));

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(false);
    expect(opened).toHaveLength(0);
    expect(restoreBackupArchive).not.toHaveBeenCalled();
    expect($createNotice).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  describe('askBackupPassphrase', () => {

    it('reads an empty passphrase as "do not encrypt"', async () => {
      answers = [{ event: 'confirm', data: '' }];

      const { askBackupPassphrase } = setup();

      await expect(askBackupPassphrase()).resolves.toEqual({ passphrase: undefined });
      expect(opened[0].props.mode).toBe('create');
    });

    it('passes a typed passphrase on', async () => {
      answers = [{ event: 'confirm', data: 'a passphrase' }];

      const { askBackupPassphrase } = setup();

      await expect(askBackupPassphrase()).resolves.toEqual({ passphrase: 'a passphrase' });
    });

    // Undefined is how backing out is told apart from asking for no encryption.
    it('answers undefined when the user backs out', async () => {
      answers = [{ event: 'cancel' }];

      const { askBackupPassphrase } = setup();

      await expect(askBackupPassphrase()).resolves.toBeUndefined();
    });

    it('skips the dialog when this build cannot encrypt', async () => {
      // What a runtime without WebCrypto looks like: getRandomValues is there,
      // subtle is not.
      vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues });

      const { askBackupPassphrase } = setup();

      await expect(askBackupPassphrase()).resolves.toEqual({});
      expect(opened).toHaveLength(0);
    });

  });

});
