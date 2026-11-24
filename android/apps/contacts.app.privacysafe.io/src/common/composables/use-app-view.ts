/*
 Copyright (C) 2020 - 2026 3NSoft Inc.

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

import { computed, inject, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import {
  VueBusPlugin,
  VUEBUS_KEY,
  ThemePlugin,
  THEME_KEY,
  NotificationsPlugin,
  NOTIFICATIONS_KEY,
  DialogsPlugin,
  DIALOGS_KEY,
} from '@v1nt1248/3nclient-lib/plugins';
import { makeServiceCaller } from '@shared/ipc/ipc-service-caller';
import {
  appContactsSrvProxy,
  initializeServices,
  servicesInitError,
} from '@main/common/services/services-provider';
import { connectToContactsService } from '@main/common/services/connect-with-retries';
import { useAppStore } from '@main/common/store/app.store';
import { useSyncStore } from '@main/common/store/sync.store';
import { useContactsStore } from '@main/common/store/contacts.store';
import { useTutorialStore } from '@main/common/store/tutorial.store';
import { useSettingsStore } from '@main/common/store/settings.store';
import {
  reportServerReachability,
  useConnectivityStatus,
} from '@main/common/composables/use-connectivity-status';
import type { AppGlobalEvents, AppMenuAction } from '@main/types';
import type { ContactsDenoSrv } from '@deno/types';
import { useCommandHandler } from '@main/common/composables/use-command-handler';
import { makeContactEventHandler } from '@main/common/composables/contact-event-handler';
import { useBackupRestore } from '@main/common/composables/use-backup-restore';
import { syncStuckWarningKey } from '@main/common/utils/sync-stuck-warning';
import BackupCreatingDialog from '@main/common/components/dialogs/backup-creating-dialog.vue';
import AppSettingsDialog from '@main/common/components/dialogs/app-settings-dialog.vue';

export type AppViewInstance = ReturnType<typeof useAppView>;

/** Pause between attempts to reach the service after the window gave up on it. */
const SERVICE_RECONNECT_PAUSE_MS = 15000;

export function useAppView() {
  const { t } = useI18n();
  const route = useRoute();
  const router = useRouter();

  const { setTheme } = inject<ThemePlugin>(THEME_KEY)!;
  const { $emitter } = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY);

  const { connectivityStatus, isConnectivitySettled } = useConnectivityStatus();

  const appStore = useAppStore();
  const { user, appElement, appVersion, colorTheme, customLogoSrc, globalLoading } = storeToRefs(appStore);
  const { setGlobalLoading, onBackupProgress, onRestoreProgress, onShareProgress } = appStore;

  const { askBackupPassphrase, runRestoreWorkflow } = useBackupRestore();

  const syncStore = useSyncStore();
  const { isSyncRunning } = storeToRefs(syncStore);
  const { addToSyncList, removeFromSyncList, cleanSyncList } = syncStore;

  const contactsStore = useContactsStore();
  const { contacts } = storeToRefs(contactsStore);
  const { fetchContacts } = contactsStore;

  const tutorialStore = useTutorialStore();
  const settingsStore = useSettingsStore();

  const connectivityStatusText = computed(() => t(`app.status.connected.${connectivityStatus.value}`));

  const syncStatusText = computed(() => (isSyncRunning.value ? t('app.status.unsynced') : t('app.status.synced')));

  /**
   * Standing warning about a state the status line above cannot express: the
   * app is online, yet what the user sees is not reaching the server. Kept as a
   * message rather than a flag, because there are two different reasons for it
   * and the user can only act on one of them.
   */
  const persistentWarning = ref<string | undefined>(undefined);

  /**
   * The reasons need different words because the remedy differs. A root that
   * will not verify means the server does not answer, and that clears itself
   * once it does - telling the user to restart, as this used to, sent them to
   * a remedy that cannot help while the server is down. Changes that cannot
   * be published stay unpublished for the life of the process: the platform
   * keeps a failed upload task in its map and refuses every later upload of
   * that file, so only a restart resumes publishing.
   */
  function setSyncStuck(isStuck: boolean, reason?: string) {
    if (!isStuck) {
      persistentWarning.value = undefined;
      return;
    }

    persistentWarning.value = t(syncStuckWarningKey(reason));
  }

  /**
   * Tells the one failure the user CAN act on - the app's storage has never
   * been opened on this device, and the platform can only create it with the
   * server reachable - apart from any other reason the service did not start.
   *
   * Asked here rather than in the service, because the service does not expose
   * its ipc until it has that storage: in this very state the window gets a
   * connection timeout and nothing else. This call goes to the same core, so it
   * fails the same way, and the window can finally say something useful.
   */
  async function reportWhyServiceIsUnavailable(err: unknown) {
    let isFirstRunWithoutNetwork = false;
    try {
      await w3n.storage!.getAppSyncedFS!();
    } catch (storageErr) {
      isFirstRunWithoutNetwork = (storageErr as web3n.ConnectException).type === 'connect';
    }

    persistentWarning.value = isFirstRunWithoutNetwork
      ? t('app.warning.first-run-needs-network')
      : t('app.warning.service-unavailable');

    // The level follows the cause. A first run without the network is expected
    // and already explained to the user by the warning above, so logging it as
    // an error would be the same crying wolf that was just cleaned out of these
    // logs. Anything else is a real failure and keeps the exception with it.
    if (isFirstRunWithoutNetwork) {
      await w3n.log('info', 'App storage is not reachable: the first run of this app needs the network');
    } else {
      await w3n.log('error', 'Contacts service is unavailable', err);
    }
  }

  async function appExit() {
    w3n.closeSelf!();
  }

  async function makeBackup() {
    // The passphrase is settled before the work starts: the archive is built
    // and encrypted in one pass, and there is nothing to ask for afterwards.
    const choice = await askBackupPassphrase();
    if (!choice) {
      return;
    }

    await dialog?.$openDialog(BackupCreatingDialog, {
      passphrase: choice.passphrase,
      dialogProps: {
        icon: 'outline-file-download',
        title: t('backup.create.dialogTitle'),
        cssStyle: { width: '570px', maxWidth: '95%' },
        hideCloseButton: true,
        confirmButton: false,
        cancelButton: false,
        closeOnClickOverlay: false,
      },
    });
  }

  async function openSettings() {
    // The desktop menu stays open by itself; the mobile one is closed already.
    if (route.query.isMenuOpen === 'on') {
      await router.push({ query: { ...route.query, isMenuOpen: 'off' } });
    }

    await dialog?.$openDialog(AppSettingsDialog, {
      dialogProps: {
        title: t('settings.title'),
        icon: 'outline-settings',
        cssStyle: { width: '560px', maxWidth: '95%' },
        confirmButton: false,
        cancelButton: false,
        closeOnClickOverlay: true,
      },
    });
  }

  async function runMenuAction(action: AppMenuAction) {
    switch (action) {
      case 'tutorial': {
        await tutorialStore.resetTutorial();
        await router.push({ query: { isMenuOpen: 'off' } });
        setTimeout(() => {
          void tutorialStore.checkAndRunSteps();
        }, 200);
        break;
      }
      case 'make-backup':
        return makeBackup();
      case 'upload-backup':
        return void (await runRestoreWorkflow());
      case 'settings':
        return openSettings();
      case 'exit':
        return appExit();
      default:
        return undefined;
    }
  }

  const { start: startHandlingCommands } = useCommandHandler();

  // Announced only between readings that are both real: the first one, which
  // replaces the initial guess, is not news to the user.
  watch(
    [connectivityStatus, isConnectivitySettled],
    ([val, isSettled], [oVal, wasSettled]) => {
      if (!isSettled || !wasSettled || (val === oVal)) {
        return;
      }

      $createNotice({
        type: val === 'online' ? 'info' : 'warning',
        content: t(`app.info.status.${val}`),
        duration: 4000,
      });
    },
  );

  watch(colorTheme, id => setTheme(id), { immediate: true });

  const handleContactEvent = makeContactEventHandler({
    addToSyncList,
    removeFromSyncList,
    cleanSyncList,
    setSyncStuck,
    setServerReachable: reportServerReachability,
    emitContactListUpdated: () => $emitter.emit('contact-list:updated', void 0),
    fetchContacts: () => fetchContacts({}),
    currentRouteName: () => route.name as string | undefined,
    openContactId: () => route.params.id as string | undefined,
    listedContactIds: () => contacts.value.map(c => c.id),
    goToContactList: () => router.push({ name: 'contacts' }),
    onBackupProgress,
    onRestoreProgress,
    onShareProgress,
    onSettingsChanged: settingsStore.applySettings,
  });

  let tu: ReturnType<typeof setInterval> | null = null;

  /** Set once the parts of the window that do not need the service are up. */
  let isWindowStateInitialized = false;

  /** Set by unmounting, to end the reconnection loop below. */
  let isUnmounted = false;

  async function initializeWithService(): Promise<void> {
    // The start-up attempts already failed: the caller tells the user at once.
    if (!appContactsSrvProxy) {
      throw servicesInitError ?? new Error('Contacts service is not connected');
    }
    const contactsSrvConnection = await connectToContactsService();
    const contactsDenoSrv = makeServiceCaller(contactsSrvConnection, [], ['watchEvent']) as ContactsDenoSrv;

    // Once only: a reconnection after a failed start must not subscribe to the
    // launcher's settings a second time.
    if (!isWindowStateInitialized) {
      await appStore.initialize();
      // Before the contacts: the form shows dates in the format set here.
      await settingsStore.loadSettings();
      isWindowStateInitialized = true;
    }

    contactsDenoSrv.watchEvent({
      next: handleContactEvent,
      error: (e: unknown) => {
        // A closed connection is what a normal shutdown looks like from here:
        // the service goes away and this observable errors. Logged as an
        // error it buried real failures under one such entry per app close.
        if ((e as web3n.rpc.RPCException).connectionClosed) {
          return;
        }

        w3n.log('error', 'Error watching contact events. ', e);
      },
      complete: () => contactsSrvConnection.close(),
    });

    // The service learns this during its start, before the window can listen
    // to its events, so the first reading is asked for. Not worth failing the
    // window over: the socket events of the platform tell the same, later.
    try {
      reportServerReachability(await appContactsSrvProxy.getServerReachability());
    } catch (err) {
      await w3n.log('info', 'Could not ask the contacts service whether the server is reachable', err);
    }

    await fetchContacts({ withFullOverload: true });

    tu = setInterval(() => {
      appContactsSrvProxy.removeUnnecessaryImageFiles();
    }, 86400000); // every 24 hours

    await startHandlingCommands();
  }

  /**
   * Keeps trying to reach the service after the window has given up on it at
   * start, so that the user does not have to close and reopen the window once
   * the service is up. The service exposes its ipc only at the end of its own
   * start, which can outlast the start-up attempts of the window.
   */
  async function reconnectInBackground(): Promise<void> {
    while (!isUnmounted) {
      await new Promise(resolve => setTimeout(resolve, SERVICE_RECONNECT_PAUSE_MS));
      if (isUnmounted) {
        return;
      }

      await initializeServices({ quiet: true });
      if (!appContactsSrvProxy) {
        continue;
      }

      try {
        await initializeWithService();
        persistentWarning.value = undefined;
        await w3n.log('info', 'Contacts service connected after the window had started without it');
        return;
      } catch (err) {
        await w3n.log('info', 'Contacts service connected, but the window could not start on it', err);
        return;
      }
    }
  }

  async function doBeforeMount() {
    setGlobalLoading(true);
    try {
      await initializeWithService();
    } catch (e) {
      await reportWhyServiceIsUnavailable(e);
      void reconnectInBackground();
    } finally {
      setGlobalLoading(false);
    }
  }

  function doBeforeUnmount() {
    isUnmounted = true;

    if (tu) {
      clearInterval(tu);
      tu = null;
    }

    appStore.stopWatching();
  }

  return {
    t,
    route,
    router,
    user,
    connectivityStatus,
    customLogoSrc,
    appElement,
    appVersion,
    connectivityStatusText,
    isSyncRunning,
    syncStatusText,
    persistentWarning,
    globalLoading,
    appExit,
    runMenuAction,
    doBeforeMount,
    doBeforeUnmount,
  };
}
