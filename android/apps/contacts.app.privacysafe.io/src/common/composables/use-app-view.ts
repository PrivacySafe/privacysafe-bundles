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
import { appContactsSrvProxy } from '@main/common/services/services-provider';
import { useAppStore } from '@main/common/store/app.store';
import { useSyncStore } from '@main/common/store/sync.store';
import { useContactsStore } from '@main/common/store/contacts.store';
import { useTutorialStore } from '@main/common/store/tutorial.store';
import { useConnectivityStatus } from '@main/common/composables/use-connectivity-status';
import type { AppGlobalEvents, AppMenuAction } from '@main/types';
import type { ContactsDenoSrv } from '@deno/types';
import { useCommandHandler } from '@main/common/composables/use-command-handler';
import { makeContactEventHandler } from '@main/common/composables/contact-event-handler';
import { useBackupRestore } from '@main/common/composables/use-backup-restore';
import BackupCreatingDialog from '@main/common/components/dialogs/backup-creating-dialog.vue';

export type AppViewInstance = ReturnType<typeof useAppView>;

export function useAppView() {
  const { t } = useI18n();
  const route = useRoute();
  const router = useRouter();

  const { setTheme } = inject<ThemePlugin>(THEME_KEY)!;
  const { $emitter } = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY);

  const { connectivityStatus } = useConnectivityStatus();

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

  const connectivityStatusText = computed(() =>
    connectivityStatus.value === 'online' ? t('app.status.connected.online') : t('app.status.connected.offline'),
  );

  const syncStatusText = computed(() => (isSyncRunning.value ? t('app.status.unsynced') : t('app.status.synced')));

  /**
   * Standing warning about a state the status line above cannot express: the
   * app is online, yet what the user sees is not reaching the server. Kept as a
   * message rather than a flag, because there are two different reasons for it
   * and the user can only act on one of them.
   */
  const persistentWarning = ref<string | undefined>(undefined);

  /**
   * The two reasons need different words because the remedy differs. A root
   * that will not verify usually clears itself once the server answers, while
   * changes that cannot be published stay unpublished for the life of the
   * process: the platform keeps a failed upload task in its map and refuses
   * every later upload of that file, so only a restart resumes publishing.
   */
  function setSyncStuck(isStuck: boolean, reason?: string) {
    if (!isStuck) {
      persistentWarning.value = undefined;
      return;
    }

    persistentWarning.value =
      reason === 'local-version-not-published'
        ? t('app.warning.changes-not-published')
        : t('app.warning.sync-stuck');
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
      case 'exit':
        return appExit();
      default:
        return undefined;
    }
  }

  const { start: startHandlingCommands } = useCommandHandler();

  watch(
    connectivityStatus,
    async (val, oVal) => {
      if (val === 'online' && oVal === 'offline') {
        $createNotice({
          type: 'info',
          content: t('app.info.status.online'),
          duration: 4000,
        });
      } else if (val === 'offline' && oVal === 'online') {
        $createNotice({
          type: 'warning',
          content: t('app.info.status.offline'),
          duration: 4000,
        });
      }
    },
    {
      immediate: true,
    },
  );

  watch(colorTheme, id => setTheme(id), { immediate: true });

  const handleContactEvent = makeContactEventHandler({
    addToSyncList,
    removeFromSyncList,
    cleanSyncList,
    setSyncStuck,
    emitContactListUpdated: () => $emitter.emit('contact-list:updated', void 0),
    fetchContacts: () => fetchContacts({}),
    currentRouteName: () => route.name as string | undefined,
    openContactId: () => route.params.id as string | undefined,
    listedContactIds: () => contacts.value.map(c => c.id),
    goToContactList: () => router.push({ name: 'contacts' }),
    onBackupProgress,
    onRestoreProgress,
    onShareProgress,
  });

  let tu: ReturnType<typeof setInterval> | null = null;

  async function doBeforeMount() {
    setGlobalLoading(true);
    try {
      const contactsSrvConnection = await w3n.rpc!.thisApp!('AppContactsInternal');
      const contactsDenoSrv = makeServiceCaller(contactsSrvConnection, [], ['watchEvent']) as ContactsDenoSrv;

      await appStore.initialize();

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

      await fetchContacts({ withFullOverload: true });

      tu = setInterval(() => {
        appContactsSrvProxy.removeUnnecessaryImageFiles();
      }, 86400000); // every 24 hours

      await startHandlingCommands();
    } catch (e) {
      await reportWhyServiceIsUnavailable(e);
    } finally {
      setGlobalLoading(false);
    }
  }

  function doBeforeUnmount() {
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
