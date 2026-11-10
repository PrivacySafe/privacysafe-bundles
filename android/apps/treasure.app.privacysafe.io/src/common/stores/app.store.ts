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
import { ref } from 'vue';
import { defineStore } from 'pinia';
import { blobFromDataURL, getActiveTheme, SystemSettings } from '@/common/utils';
import { packEncryptedContainer } from '@/common/utils/backup-container';
import { appTreasureDenoSrv } from '@/common/services/service-provider';
import { backupFileName } from '@shared/utils/backup-archive';
import type { Ui3nNotificationProps, Nullable } from '@v1nt1248/3nclient-lib';
import type { ThemeId } from '@v1nt1248/3nclient-lib/plugins';
import type {
  AppConfig,
  AppConfigs,
  AvailableLanguage,
  BackupProgress,
  RestoreProgress,
} from '@shared/@types';

function isBackupCancelledError(err: unknown): boolean {
  const errorObj = err as (Error & { cause?: unknown }) | undefined;
  const combined = [
    errorObj?.name,
    errorObj?.message,
    errorObj?.stack,
    typeof errorObj?.cause === 'string' ? errorObj.cause : (errorObj?.cause as Error | undefined)?.message,
    (errorObj?.cause as Error | undefined)?.stack,
  ]
    .filter(Boolean)
    .join(' ');

  return Boolean(
    errorObj?.name === 'AbortError' ||
      /cancelled|aborterror|aborted/i.test(combined),
  );
}

async function saveBackupArchiveToFile(
  archiveBytes: Uint8Array,
  appVersion: string,
  t: (key: string, options?: Record<string, string>) => string,
): Promise<{ saved: boolean; fileName?: string }> {
  const defaultFileName = backupFileName(new Date(), appVersion);

  if (!w3n.shell?.fileDialogs?.saveFileDialog) {
    return { saved: false };
  }

  const file = await w3n.shell.fileDialogs.saveFileDialog(
    t('backup.create.fileDialogTitle'),
    t('backup.create.fileDialogBtn'),
    defaultFileName,
    { filters: [{ name: 'ZIP Archive', extensions: ['zip'] }] },
  );

  if (!file) {
    return { saved: false };
  }

  await file.writeBytes(archiveBytes);
  return { saved: true, fileName: file.name || defaultFileName };
}

export const useAppStore = defineStore('app', () => {
  const appVersion = ref<string>('');
  const connectivityStatus = ref<string>('offline');
  const user = ref<Nullable<string>>(null);
  const lang = ref<AvailableLanguage>('en');
  const colorTheme = ref<ThemeId>('dark');
  const customLogoSrc = ref<string>();
  const appWindowSize = ref<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  // @ts-ignore
  const operatingSystem = ref<'macos' | 'linux' | 'windows'>(navigator.userAgentData?.platform.toLowerCase());
  const commonLoading = ref<boolean>(false);

  const backupProgress = ref<BackupProgress | null>(null);
  const restoreProgress = ref<RestoreProgress | null>(null);

  async function getAppVersion() {
    appVersion.value = await w3n.myVersion();
  }

  async function getUser() {
    user.value = await w3n.mailerid!.getUserId();
  }

  function setConnectivityStatus(value: boolean) {
    connectivityStatus.value = value ? 'online' : 'offline';
  }

  function setAppWindowSize({ width = 0, height = 0 }) {
    appWindowSize.value = {
      ...appWindowSize.value,
      ...(width && { width }),
      ...(height && { height }),
    };
  }

  function setCommonLoading(value: boolean) {
    commonLoading.value = value;
  }

  function setLang(value: AvailableLanguage) {
    lang.value = value;
  }

  // Only the value is kept here. Putting it on the document is the job of the
  // library's theme plugin, which the app view drives off this ref.
  function setColorTheme(theme: ThemeId) {
    colorTheme.value = theme;
  }

  async function setCustomLogo(dataURL: AppConfig['customLogo']): Promise<void> {
    if (dataURL) {
      try {
        const imgBlob = blobFromDataURL(dataURL);
        customLogoSrc.value = URL.createObjectURL(imgBlob);
      } catch (err) {
        console.error(`Parsing dataURL with customLogo throws error:`, err);
      }
    } else {
      customLogoSrc.value = undefined;
    }
  }

  async function getAppConfig(): Promise<AppConfigs | undefined> {
    try {
      const config = await SystemSettings.makeResourceReader();
      const { lang, colorTheme, customLogo } = await config.getAll();
      setLang(lang);
      setColorTheme(getActiveTheme(colorTheme));
      await setCustomLogo(customLogo);

      return config;
    } catch (e) {
      console.error('Load the app config error: ', e);
    }
  }

  function onBackupProgress(progress: BackupProgress | null) {
    backupProgress.value = progress;
  }

  function onRestoreProgress(progress: RestoreProgress | null) {
    restoreProgress.value = progress;
  }

  function showBackupCancellingNotice(
    t: (key: string, options?: Record<string, string>) => string,
    $createNotice: (params: Ui3nNotificationProps) => void,
  ) {
    if (backupProgress.value === null) {
      return;
    }

    $createNotice({
      type: 'warning',
      content: t('backup.create.cancel'),
      duration: 4000,
    });

    onBackupProgress(null);
  }

  function showBackupWarningNotice(text: string, $createNotice: (params: Ui3nNotificationProps) => void) {
    $createNotice({
      type: 'info',
      content: text,
      duration: 4000,
    });

    onBackupProgress(null);
  }

  async function cancelBackup(
    t: (key: string, options?: Record<string, string>) => string,
    $createNotice: (params: Ui3nNotificationProps) => void,
  ): Promise<void> {
    try {
      await appTreasureDenoSrv.cancelBackupArchive?.();
    } catch (err) {
      console.error('Error cancelling backup archive: ', err);
    } finally {
      showBackupCancellingNotice(t, $createNotice);
    }
  }

  function handleBackupError(
    err: unknown,
    t: (key: string, options?: Record<string, string>) => string,
    $createNotice: (params: Ui3nNotificationProps) => void,
  ): boolean {
    if (isBackupCancelledError(err)) {
      w3n.log?.('info', 'Backup creation was cancelled');
      showBackupCancellingNotice(t, $createNotice);
      return false;
    }

    w3n.log('error', 'Backup creation failed: ', err);

    onBackupProgress({
      stage: 'error',
      totalFiles: 0,
      processedFiles: 0,
      percent: 0,
    });

    $createNotice({
      type: 'error',
      content: t('backup.create.error'),
      duration: 4000,
    });

    setTimeout(() => {
      onBackupProgress(null);
    }, 3000);

    return false;
  }

  async function runBackupWorkflow({
    passphrase,
    t,
    $createNotice,
  }: {
    passphrase?: string;
    t: (key: string, options?: Record<string, string>) => string;
    $createNotice: (params: Ui3nNotificationProps) => void;
  }): Promise<boolean | undefined> {
    try {
      // With a passphrase the service leaves the metadata file out: it goes
      // into the container built here, where it stays readable without a key.
      const packedBytes = await appTreasureDenoSrv.createBackupArchive({
        forEncryption: !!passphrase,
      });
      if (!packedBytes) {
        showBackupWarningNotice(t('backup.create.warning'), $createNotice);
        return false;
      }

      let archiveBytes = packedBytes;
      if (passphrase) {
        onBackupProgress({
          stage: 'encrypting',
          totalFiles: 1,
          processedFiles: 1,
          percent: 100,
        });

        archiveBytes = await packEncryptedContainer(packedBytes, passphrase, appVersion.value);
      }

      onBackupProgress({
        stage: 'saving',
        totalFiles: 1,
        processedFiles: 1,
        percent: 100,
      });

      const { saved, fileName } = await saveBackupArchiveToFile(archiveBytes, appVersion.value, t);
      if (!saved) {
        showBackupCancellingNotice(t, $createNotice);
        return false;
      }

      $createNotice({
        type: 'success',
        content: t('backup.create.success', { filename: fileName! }),
        duration: 4000,
      });

      onBackupProgress(null);
      return true;
    } catch (err: unknown) {
      return handleBackupError(err, t, $createNotice);
    }
  }

  return {
    appVersion,
    operatingSystem,
    connectivityStatus,
    user,
    lang,
    colorTheme,
    customLogoSrc,
    appWindowSize,
    commonLoading,
    backupProgress,
    restoreProgress,

    runBackupWorkflow,
    cancelBackup,
    onBackupProgress,
    onRestoreProgress,

    getAppVersion,
    getUser,
    setConnectivityStatus,
    setAppWindowSize,
    setCommonLoading,
    setLang,
    setColorTheme,
    setCustomLogo,
    getAppConfig,
  };
});
