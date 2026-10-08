/*
 Copyright (C) 2025 3NSoft Inc.

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
import { computed, onBeforeMount, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useCommandHandler } from '@main/common/composables/useCommandHandler';
import { useAppStore } from '@main/common/store/app.store';
import { useContactsStore } from '@main/common/store/contacts.store';
import { useChatsStore } from '@main/common/store/chats.store';
import { useInitialize } from '@main/common/composables/useInitialize';
import { useBackupRestore } from '@main/common/composables/useBackupRestore';
import { useThemeSync } from '@main/common/composables/useThemeSync';
import { chatService } from '@main/common/services/external-services.ts';
import { makeLogger } from '@shared/logger';
import type { AppMenuAction } from '~/app.types';

const log = makeLogger('AppView');

export type AppViewInstance = ReturnType<typeof useAppView>;

export function useAppView() {
  const { t } = useI18n();

  const { start: startHandlingCommands } = useCommandHandler();

  const appStore = useAppStore();
  const contactsStore = useContactsStore();
  const chatsStore = useChatsStore();

  const {
    commonLoading, appVersion, user: me, connectivityStatus, customLogoSrc, colorTheme,
    isSyncing, syncPending, syncPhase, syncStalled, syncStatusText, showSyncStatus,
  } = storeToRefs(appStore);

  useThemeSync(colorTheme);

  const { initialize, stopMessagesProcessing, stopVideoCallsWatching } = useInitialize();
  const { startBackupWorkflow, runRestoreWorkflow } = useBackupRestore();

  const isOnline = computed(() => connectivityStatus.value === 'online');

  const connectivityStatusText = computed(() =>
    isOnline.value ? 'app.status.connected.online' : 'app.status.connected.offline',
  );

  async function openDashboard() {
    await w3n.shell!.openDashboard!();
  }

  async function appExit() {
    w3n.closeSelf!();
  }

  /**
   * The one handler of the avatar menu, for both form factors: the desktop
   * dropdown and the phone drawer emit the same action ids (see useAppMenu).
   */
  async function runMenuAction(action: AppMenuAction): Promise<void> {
    switch (action) {
      case 'make-backup':
        await startBackupWorkflow();
        break;
      case 'restore-backup':
        await runRestoreWorkflow();
        break;
      case 'exit':
        await appExit();
        break;
      default: {
        log.error(`Unknown app menu action: ${action}`);
      }
    }
  }

  async function deleteExpiredMessages() {
    return chatService.deleteExpiredMessages(Date.now());
  }

  async function collectOrphanedMessagesGarbage() {
    return chatService.collectGarbageInAuxiliaryDB();
  }

  async function removeExpiredInboxMessages() {
    return chatService.removeExpiredInboxMessages(Date.now());
  }

  let periodicCleanupTimerId: ReturnType<typeof setInterval> | null = null;

  onBeforeMount(async () => {
    try {
      await appStore.initialize();
      // Contacts must not gate the chat list: connecting to the contacts app
      // retries for up to 13 seconds (external-services.ts), while chat names
      // are reactive and re-render once contacts arrive. Awaited before
      // startHandlingCommands, which may need contacts resolved.
      const contactsInit = contactsStore.initialize();
      await initialize();
      await contactsInit;
      await startHandlingCommands();

      periodicCleanupTimerId = setInterval(() => {
        deleteExpiredMessages();
        collectOrphanedMessagesGarbage();
        removeExpiredInboxMessages();
        // Cheap - a walk of a map in memory on the other side - and it bounds
        // how long a missed call event can misinform this window to a minute.
        chatsStore.reconcileCallsState();
      }, 60000);
    } catch (e) {
      // Not re-thrown: this runs in onBeforeMount, where a throw becomes an
      // unhandled rejection and nothing on screen changes. What the user sees
      // is driven by appStore.backendState and the chat list's own error
      // state, both set by whatever failed here.
      log.error('Error while the app component mounting.', e);
    }
  });

  onBeforeUnmount(() => {
    stopMessagesProcessing.value && stopMessagesProcessing.value();
    stopVideoCallsWatching.value && stopVideoCallsWatching.value();
    appStore.stopWatching();
    contactsStore.stopWatching();
    periodicCleanupTimerId && clearInterval(periodicCleanupTimerId);
  });

  return {
    t,
    commonLoading,
    me,
    customLogoSrc,
    appVersion,
    isOnline,
    connectivityStatusText,
    isSyncing,
    syncPending,
    syncPhase,
    syncStalled,
    syncStatusText,
    showSyncStatus,
    openDashboard,
    appExit,
    runMenuAction,
    setAppWindowSize: appStore.setAppWindowSize,
  };
}
