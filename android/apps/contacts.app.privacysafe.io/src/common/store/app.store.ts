import { ref } from 'vue';
import { defineStore } from 'pinia';
import { useSystemLevelAppConfig } from './app/system-level-app-config';
import { useAppSize } from './app/app-size';
import { useBackupRestoreState } from './app/backup-restore';
import type { ShareProgress } from '@main/types';

export const useAppStore = defineStore('app', () => {
  const globalLoading = ref(false);

  const appSize = useAppSize();
  const { appElement } = appSize;

  const commonAppConfs = useSystemLevelAppConfig();
  const { appVersion, user, lang, colorTheme, customLogoSrc } = commonAppConfs;

  const backup = useBackupRestoreState();
  const {
    backupProgress, restoreProgress, onBackupProgress, onRestoreProgress,
    runBackupWorkflow, cancelBackup,
  } = backup;

  /** Progress of making and handing over a file with shared contacts. */
  const shareProgress = ref<ShareProgress | null>(null);

  function onShareProgress(value: ShareProgress | null): void {
    shareProgress.value = value;
  }

  function setGlobalLoading(value: boolean) {
    globalLoading.value = value;
  }

  async function initialize() {
    await commonAppConfs.initialize();
  }

  function stopWatching() {
    appSize.stopWatching();
    commonAppConfs.stopWatching();
  }

  return {
    appVersion,
    user,
    lang,
    colorTheme,
    customLogoSrc,
    appElement,
    globalLoading,
    backupProgress,
    restoreProgress,
    onBackupProgress,
    onRestoreProgress,
    shareProgress,
    onShareProgress,
    runBackupWorkflow,
    cancelBackup,
    initialize,
    setGlobalLoading,
    stopWatching,
  };
});
