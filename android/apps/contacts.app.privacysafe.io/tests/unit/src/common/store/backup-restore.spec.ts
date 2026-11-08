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
import { unzipSync } from 'fflate';
import type { Ui3nNotificationProps } from '@v1nt1248/3nclient-lib';

const createBackupArchive = vi.fn();
const cancelBackupArchive = vi.fn(async () => true);

vi.mock('@main/common/services/services-provider', () => ({
  appContactsSrvProxy: {
    get createBackupArchive() {
      return createBackupArchive;
    },
    get cancelBackupArchive() {
      return cancelBackupArchive;
    },
  },
}));

const { isBackupCancelledError, useBackupRestoreState } =
  await import('@main/common/store/app/backup-restore');
const { installFakeW3n } = await import('../../../helpers/fake-w3n.ts');

const ARCHIVE = new Uint8Array([1, 2, 3]);

describe('isBackupCancelledError', () => {

  // The DOMException the service throws arrives over ipc as data: no class,
  // and depending on the path no `name` either. Only text is left to go on.
  it('recognises a cancellation however little of it survived the ipc', () => {
    expect(isBackupCancelledError({ name: 'AbortError' })).toBe(true);
    expect(isBackupCancelledError(new Error('Backup cancelled'))).toBe(true);
    expect(isBackupCancelledError({ message: 'the task was aborted' })).toBe(true);
    expect(isBackupCancelledError({ cause: 'AbortError' })).toBe(true);
    expect(isBackupCancelledError({ cause: new Error('cancelled by user') })).toBe(true);

    const withStack = new Error('failure');
    withStack.stack = 'DOMException: AbortError\n at zip';
    expect(isBackupCancelledError(withStack)).toBe(true);
  });

  it('does not mistake a real failure for a cancellation', () => {
    expect(isBackupCancelledError(new Error('network is down'))).toBe(false);
    expect(isBackupCancelledError({ message: 'storage is full' })).toBe(false);
    expect(isBackupCancelledError(undefined)).toBe(false);
    expect(isBackupCancelledError(null)).toBe(false);
    expect(isBackupCancelledError({})).toBe(false);
  });

});

describe('runBackupWorkflow', () => {

  let fake: ReturnType<typeof installFakeW3n>;
  let $createNotice: ReturnType<typeof vi.fn<(params: Ui3nNotificationProps) => void>>;
  const t = (key: string) => key;

  function saveDialogAnswering(file: unknown) {
    (fake.w3n.shell.fileDialogs.saveFileDialog as ReturnType<typeof vi.fn>)
    .mockResolvedValue(file);
  }

  beforeEach(() => {
    fake = installFakeW3n();
    $createNotice = vi.fn<(params: Ui3nNotificationProps) => void>();
    createBackupArchive.mockReset();
    cancelBackupArchive.mockClear();
  });

  afterEach(() => {
    fake.uninstall();
    vi.restoreAllMocks();
  });

  it('writes the archive to the file the user picked', async () => {
    const writeBytes = vi.fn(async () => undefined);
    createBackupArchive.mockResolvedValue({ bytes: ARCHIVE, skippedImages: [] });
    saveDialogAnswering({ name: 'contacts-backup-0_8_34-2026-09-05_14-30.zip', writeBytes });

    const store = useBackupRestoreState();
    const res = await store.runBackupWorkflow({ appVersion: '0.8.34', t, $createNotice });

    expect(res).toBe(true);
    expect(writeBytes).toHaveBeenCalledWith(ARCHIVE);
    expect($createNotice).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    // Cleared, because that is what closes the progress dialog.
    expect(store.backupProgress.value).toBeNull();
  });

  // The passphrase never reaches the service: it asks for an archive without
  // metadata, and the encryption happens here, in the window.
  it('encrypts the archive itself, and saves the container', async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const writeBytes = vi.fn(async (_bytes: Uint8Array) => undefined);
    createBackupArchive.mockResolvedValue({ bytes: ARCHIVE, skippedImages: [] });
    saveDialogAnswering({ name: 'b.zip', writeBytes });

    const store = useBackupRestoreState();
    await store.runBackupWorkflow({
      passphrase: 'a passphrase', appVersion: '0.8.34', t, $createNotice,
    });

    expect(createBackupArchive).toHaveBeenCalledWith({ forEncryption: true });

    const saved = writeBytes.mock.calls[0][0];
    expect(Array.from(saved)).not.toEqual(Array.from(ARCHIVE));

    const entries = unzipSync(saved);
    expect(Object.keys(entries).sort()).toEqual(
      ['contacts_app_privacysafe_io.json', 'payload.zip.enc'],
    );

    const metadata = JSON.parse(
      new TextDecoder().decode(entries['contacts_app_privacysafe_io.json']),
    );
    expect(metadata.appDomain).toBe('contacts.app.privacysafe.io');
    expect(metadata.encryption.alg).toBe('AES-GCM');
    // Nothing about the size of the address book leaks out of an encrypted one.
    expect(metadata.contactsCount).toBeUndefined();
  }, 30000);

  it('asks for no encryption when there is no passphrase', async () => {
    const writeBytes = vi.fn(async () => undefined);
    createBackupArchive.mockResolvedValue({ bytes: ARCHIVE, skippedImages: [] });
    saveDialogAnswering({ name: 'b.zip', writeBytes });

    const store = useBackupRestoreState();
    await store.runBackupWorkflow({ appVersion: '0.8.34', t, $createNotice });

    expect(createBackupArchive).toHaveBeenCalledWith(undefined);
    // Saved as the service packed it, with nothing wrapped around it.
    expect(writeBytes).toHaveBeenCalledWith(ARCHIVE);
  });

  // Declining the save dialog is a decision, not a failure.
  it('reports a declined save dialog as a cancellation', async () => {
    createBackupArchive.mockResolvedValue({ bytes: ARCHIVE, skippedImages: [] });
    saveDialogAnswering(undefined);

    const store = useBackupRestoreState();
    const res = await store.runBackupWorkflow({ appVersion: '0.8.34', t, $createNotice });

    expect(res).toBe(false);
    expect($createNotice).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning', content: 'backup.create.cancel',
    }));
    expect(store.backupProgress.value).toBeNull();
  });

  it('reports a cancelled backup as a cancellation, not an error', async () => {
    createBackupArchive.mockRejectedValue({ name: 'AbortError', message: 'Backup cancelled' });

    const store = useBackupRestoreState();
    const res = await store.runBackupWorkflow({ appVersion: '0.8.34', t, $createNotice });

    expect(res).toBe(false);
    expect($createNotice).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
    expect(fake.w3n.shell.fileDialogs.saveFileDialog).not.toHaveBeenCalled();
  });

  it('reports a real failure as an error, and keeps it on screen for a moment', async () => {
    vi.useFakeTimers();
    createBackupArchive.mockRejectedValue(new Error('storage is full'));

    const store = useBackupRestoreState();
    const res = await store.runBackupWorkflow({ appVersion: '0.8.34', t, $createNotice });

    expect(res).toBe(false);
    expect($createNotice).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(store.backupProgress.value).toMatchObject({ stage: 'error' });

    vi.advanceTimersByTime(3000);
    expect(store.backupProgress.value).toBeNull();
    vi.useRealTimers();
  });

  it('tells the service to stop when the user cancels', async () => {
    const store = useBackupRestoreState();
    await store.cancelBackup(t, $createNotice);

    expect(cancelBackupArchive).toHaveBeenCalled();
    expect(store.backupProgress.value).toBeNull();
  });

});
