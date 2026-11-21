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
import { zipSync } from 'fflate';
import type { App, Plugin } from 'vue';

/* eslint-disable @typescript-eslint/no-unused-vars */
const validateBackupArchive = vi.fn();
const restoreBackupArchive = vi.fn(async (_bytes: Uint8Array) => true);
const getContactList = vi.fn(async (_withImage?: boolean) => []);

vi.mock('@main/common/services/services-provider', () => ({
  appContactsSrvProxy: {
    validateBackupArchive: (bytes: Uint8Array, metadata?: unknown) =>
      validateBackupArchive(bytes, metadata),
    restoreBackupArchive: (bytes: Uint8Array) => restoreBackupArchive(bytes),
    getContactList: (withImage?: boolean) => getContactList(withImage),
  },
}));

const { DIALOGS_KEY, NOTIFICATIONS_KEY } = await import('@v1nt1248/3nclient-lib/plugins');
const { packEncryptedContainer } = await import('@main/common/utils/backup-container');
const { useBackupRestore } = await import('@main/common/composables/use-backup-restore');
const { withSetup } = await import('../../../helpers/app-context.ts');
const { installFakeW3n } = await import('../../../helpers/fake-w3n.ts');

/**
 * The archive the service packs, as the gui sees it: a real zip, since the
 * composable now opens the container itself rather than asking the service to.
 */
const INNER = zipSync({
  'contacts-db': new Uint8Array([1, 2, 3, 4]),
});

function utf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** An unencrypted archive: the metadata sits inside, next to the db. */
function plainArchive(metadata?: Record<string, unknown>): Uint8Array {
  return zipSync({
    'contacts-db': new Uint8Array([1, 2, 3, 4]),
    'contacts_app_privacysafe_io.json': utf8(JSON.stringify(metadata ?? {
      appDomain: 'contacts.app.privacysafe.io',
      version: '0.8.34',
      formatVersion: 1,
      createdAt: '2026-09-05T00:00:00.000Z',
    })),
  });
}

/** Deriving a key runs 250k PBKDF2 rounds, which the default timeout dislikes. */
const TIMEOUT = 30000;

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

  function fileDialogAnswering(bytes: Uint8Array | null) {
    (fake.w3n.shell.fileDialogs.openFileDialog as ReturnType<typeof vi.fn>)
    .mockResolvedValue(bytes ? [{ readBytes: async () => bytes }] : undefined);
  }

  function setup() {
    const res = withSetup(() => useBackupRestore(), { plugins: pluginsProviding() });
    app = res.app;
    return res.result;
  }

  beforeEach(() => {
    fake = installFakeW3n();
    opened = [];
    answers = [];
    $createNotice = vi.fn();
    validateBackupArchive.mockReset();
    restoreBackupArchive.mockClear();
    getContactList.mockClear();
  });

  afterEach(() => {
    app?.unmount();
    app = undefined;
    fake.uninstall();
    vi.restoreAllMocks();
  });

  it('does nothing when no file is picked', async () => {
    fileDialogAnswering(null);

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(false);
    expect(validateBackupArchive).not.toHaveBeenCalled();
  });

  // Every reason an archive cannot be read has to be caught BEFORE the user is
  // asked to confirm something that deletes their contacts.
  it('refuses an archive that holds no contacts, without restoring', async () => {
    fileDialogAnswering(plainArchive());
    validateBackupArchive.mockResolvedValue({
      valid: false, compatible: false, appVersion: '0.8.34', error: 'no_contacts_db',
    });

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(false);
    expect($createNotice).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(restoreBackupArchive).not.toHaveBeenCalled();
    expect(opened).toHaveLength(0);
  });

  // The passphrase is used here, in the window: the service is handed the
  // archive already decrypted, and never sees the passphrase at all.
  it('asks for a passphrase, and decrypts before reaching the service', async () => {
    fileDialogAnswering(await packEncryptedContainer(INNER, 'the passphrase', '0.8.34'));
    validateBackupArchive.mockResolvedValue({
      valid: true, compatible: true, appVersion: '0.8.34', contactsCount: 3,
    });
    answers = [
      { event: 'confirm', data: 'the passphrase' },
      { event: 'confirm' },
    ];

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(true);
    expect(opened[0].props.mode).toBe('open');

    // What the service got is the inner archive, not the container.
    const [validatedBytes, outerMetadata] = validateBackupArchive.mock.calls[0];
    expect(Array.from(validatedBytes as Uint8Array)).toEqual(Array.from(INNER));
    expect((outerMetadata as { encryption?: unknown }).encryption).toBeDefined();

    const [restoredBytes] = restoreBackupArchive.mock.calls[0];
    expect(Array.from(restoredBytes)).toEqual(Array.from(INNER));
  }, TIMEOUT);

  // A mistyped passphrase is a slip; the whole flow should not have to restart.
  // A mistyped passphrase is a slip; the whole flow should not have to restart.
  it('asks again after a wrong passphrase, and marks the dialog as such', async () => {
    fileDialogAnswering(await packEncryptedContainer(INNER, 'right one', '0.8.34'));
    validateBackupArchive.mockResolvedValue({
      valid: true, compatible: true, appVersion: '0.8.34', contactsCount: 1,
    });
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
    fileDialogAnswering(await packEncryptedContainer(INNER, 'the passphrase', '0.8.34'));
    answers = [{ event: 'cancel' }];

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(false);
    expect(validateBackupArchive).not.toHaveBeenCalled();
    expect(restoreBackupArchive).not.toHaveBeenCalled();
  }, TIMEOUT);

  // Another app's backup unpacks and its entries look restorable, so it has to
  // be named as foreign - and before the user is asked for anything.
  it('refuses a backup of another app without asking for a passphrase', async () => {
    fileDialogAnswering(zipSync({
      'treasure_app_privacysafe_io.json': utf8('{"version":"0.2.3"}'),
      'payload.zip.enc': new Uint8Array([9, 9, 9]),
    }));

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(false);
    expect(opened).toHaveLength(0);
    expect(validateBackupArchive).not.toHaveBeenCalled();
    expect(restoreBackupArchive).not.toHaveBeenCalled();
    expect($createNotice).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('warns about an incompatible archive, and does nothing if declined', async () => {
    fileDialogAnswering(plainArchive());
    validateBackupArchive.mockResolvedValue({
      valid: true, compatible: false, appVersion: '0.8.34',
      archiveVersion: '0.5.0', contactsCount: 2,
    });
    answers = [{ event: 'cancel' }];

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(false);
    expect(opened[0].dialogProps.confirmButtonText)
    .toBe('Restore anyway');
    expect(restoreBackupArchive).not.toHaveBeenCalled();
  });

  it('restores once the user confirms, and refreshes the list', async () => {
    fileDialogAnswering(plainArchive());
    validateBackupArchive.mockResolvedValue({
      valid: true, compatible: true, appVersion: '0.8.34', contactsCount: 5,
    });
    answers = [{ event: 'confirm' }];

    const { runRestoreWorkflow } = setup();

    await expect(runRestoreWorkflow()).resolves.toBe(true);
    expect(restoreBackupArchive).toHaveBeenCalledTimes(1);
    expect(getContactList).toHaveBeenCalled();
    expect($createNotice).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  describe('askBackupPassphrase', () => {

    it('skips the dialog when this build cannot encrypt', async () => {
      // What a runtime without WebCrypto looks like: getRandomValues is there,
      // subtle is not.
      vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues });

      const { askBackupPassphrase } = setup();

      await expect(askBackupPassphrase()).resolves.toEqual({});
      expect(opened).toHaveLength(0);

      vi.unstubAllGlobals();
    });

    // An empty passphrase is the way to ask for an unencrypted archive, and
    // must not be passed on as one.
    it('reads an empty passphrase as "do not encrypt"', async () => {
      answers = [{ event: 'confirm', data: '' }];

      const { askBackupPassphrase } = setup();

      await expect(askBackupPassphrase()).resolves.toEqual({ passphrase: undefined });
      expect(opened[0].props.mode).toBe('create');
    });

    it('answers nothing at all when the user backs out', async () => {
      answers = [{ event: 'cancel' }];

      const { askBackupPassphrase } = setup();

      await expect(askBackupPassphrase()).resolves.toBeUndefined();
    });

  });

});
