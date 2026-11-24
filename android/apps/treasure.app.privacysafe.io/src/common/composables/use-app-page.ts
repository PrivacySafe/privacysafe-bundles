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
import { computed, inject, onBeforeMount, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import {
  DIALOGS_KEY,
  NOTIFICATIONS_KEY,
  THEME_KEY,
  type DialogsPlugin,
  type NotificationsPlugin,
  type ThemePlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { makeServiceCaller } from '@shared/ipc/ipc-service-caller';
import { appTreasureDenoSrv } from '@/common/services/service-provider';
import { useAppStore } from '@/common/stores/app.store';
import { useSyncStore } from '@/common/stores/sync.store';
import { useRecordStore } from '@/common/stores/record.store';
import { useBackupRestore } from '@/common/composables/use-backup-restore';
import { reportServerReachability, useConnectivityStatus } from '@/common/composables/use-connectivity-status';
import { getActiveTheme, SystemSettings } from '@/common/utils';
import type { Ui3nResizeCbArg } from '@v1nt1248/3nclient-lib';
import type { TreasureDenoSrv } from '@deno/srv.types';
import type {
  TreasureSyncStartEvent,
  TreasureSyncEndEvent,
  TreasureSyncUpdateEvent,
  TreasureAddEvent,
  TreasureRemoveEvent,
  TreasureRecord,
  TreasureUpdateEvent,
  TreasureServerReachabilityEvent,
} from '@shared/@types';
import BackupCreatingDialog from '@/common/components/dialogs/backup-creating-dialog.vue';

export function useAppPage() {
  const { t } = useI18n();
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY);
  const { setTheme } = inject<ThemePlugin>(THEME_KEY)!;
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY);

  const appStore = useAppStore();
  const {
    getAppVersion,
    getUser,
    setAppWindowSize,
    getAppConfig,
    setLang,
    setColorTheme,
    setCustomLogo,
    onBackupProgress,
    onRestoreProgress,
  } = appStore;
  const { appVersion, colorTheme, commonLoading, customLogoSrc, user } = storeToRefs(appStore);

  // The launcher owns the theme; the store only mirrors it, and the plugin puts
  // it on the document.
  watch(colorTheme, id => setTheme(id), { immediate: true });

  const { askBackupPassphrase, runRestoreWorkflow } = useBackupRestore();

  const syncStore = useSyncStore();
  const { isSyncRunning } = storeToRefs(syncStore);
  const { addRecordToSyncList, removeRecordFromSyncList, updateSyncListRecord } = syncStore;

  const { getAllGroups, getAllRecords, getRecord, getRecords, loadRecentRecords, updateRecordList } =
    useRecordStore();

  const { connectivityStatus, isConnectivitySettled } = useConnectivityStatus();

  const connectivityStatusText = computed(() => t(`app.status.connected.${connectivityStatus.value}`));
  const syncStatusText = computed(() => (isSyncRunning.value ? t('app.status.unsynced') : t('app.status.synced')));

  // Only changes between two real readings are announced: the first reading
  // replacing the initial guess is not news to the user.
  watch([connectivityStatus, isConnectivitySettled], ([val, isSettled], [oVal, wasSettled]) => {
    if (!isSettled || !wasSettled || val === oVal) {
      return;
    }

    notifications?.$createNotice({
      type: val === 'online' ? 'info' : 'warning',
      content: t(`app.info.status.${val}`),
      duration: 4000,
    });
  });

  function onResize(value: Ui3nResizeCbArg) {
    setAppWindowSize({ width: value.width, height: value.contentHeight });
  }

  function openDashboard() {
    w3n.shell!.openDashboard!();
  }

  function exitApp() {
    w3n.closeSelf();
  }

  async function runMenuAction(event: 'exit' | 'make-backup' | 'upload-backup') {
    switch (event) {
      case 'exit': {
        exitApp();
        break;
      }

      case 'make-backup': {
        // The passphrase is settled before the work starts: the archive is
        // packed and encrypted in one pass, with nothing to ask for afterwards.
        const choice = await askBackupPassphrase();
        if (!choice) {
          break;
        }

        await dialog?.$openDialog(BackupCreatingDialog, {
          passphrase: choice.passphrase,
          dialogProps: {
            icon: 'outline-file-download',
            title: t('backup.create.dialogTitle'),
            cssStyle: { width: '570px', maxWidth: '95%', borderRadius: '16px' },
            hideCloseButton: true,
            confirmButton: false,
            cancelButton: false,
          },
        });
        break;
      }

      case 'upload-backup': {
        await runRestoreWorkflow();
        break;
      }

      // no default
    }
  }

  onBeforeMount(async () => {
    await getAppVersion();
    await getUser();
    await getAppConfig();
    await getAllGroups();
    await getAllRecords();
    await loadRecentRecords();

    const config = await SystemSettings.makeResourceReader();
    config.watchConfig({
      next: appConfig => {
        const { lang, colorTheme, customLogo } = appConfig;
        setLang(lang);
        setColorTheme(getActiveTheme(colorTheme));
        setCustomLogo(customLogo);
      },
    });

    const treasureSrvConnection = await w3n.rpc!.thisApp!('AppTreasureInternal');
    const treasureSrv = makeServiceCaller(treasureSrvConnection, [], ['watchEvent']) as TreasureDenoSrv;
    treasureSrv.watchEvent({
      next: eventObj => {
        // console.log('🔔 WATCH EVENT FROM DENO => ', JSON.stringify(eventObj));
        // @ts-expect-error
        const { event, payload = {} } = eventObj;

        switch (event) {
          case 'sync:start': {
            const { path, type } = payload as TreasureSyncStartEvent['payload'];
            addRecordToSyncList(path, type);
            break;
          }

          case 'sync:end': {
            const { path } = payload as TreasureSyncEndEvent['payload'];
            removeRecordFromSyncList(path);
            break;
          }

          case 'sync:update': {
            const { path, type, value } = payload as TreasureSyncUpdateEvent['payload'];
            updateSyncListRecord(path, type, value);
            break;
          }

          case 'add:record': {
            const { data } = payload as TreasureAddEvent['payload'];
            getRecords(data);
            break;
          }

          case 'remove:record': {
            const { data } = payload as TreasureRemoveEvent['payload'];
            for (const recordId of data) {
              updateRecordList({ id: recordId } as TreasureRecord, true);
            }
            break;
          }

          case 'update:record': {
            const { data } = payload as TreasureUpdateEvent['payload'];
            getRecord(data);
            break;
          }

          case 'update:group': {
            getAllGroups();
            break;
          }

          case 'update:records': {
            getAllRecords();
            break;
          }

          case 'backup': {
            onBackupProgress(payload);
            break;
          }

          case 'restore': {
            onRestoreProgress(payload);
            break;
          }

          case 'server:reachability': {
            const { reachable } = payload as TreasureServerReachabilityEvent['payload'];
            reportServerReachability(reachable);
            break;
          }

          // no default
        }
      },
      error: err => w3n.log('error', '🔥 Error watching storage events. ', err),
      complete: () => treasureSrvConnection.close(),
    });

    await appTreasureDenoSrv.initial();

    // The service checks the server at startup, possibly before this window
    // subscribed to its events; the outcome it kept fills that gap.
    try {
      reportServerReachability(await appTreasureDenoSrv.getServerReachability());
    } catch (err) {
      w3n.log('error', '🔥 Error reading the server reachability. ', err);
    }
  });

  return {
    appVersion,
    commonLoading,
    customLogoSrc,
    user,
    connectivityStatus,
    connectivityStatusText,
    isSyncRunning,
    syncStatusText,

    t,
    onResize,
    openDashboard,
    runMenuAction,
    exitApp,
  };
}
