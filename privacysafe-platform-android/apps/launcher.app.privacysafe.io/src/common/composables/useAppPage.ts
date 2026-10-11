/*
 Copyright (C) 2024 - 2026 3NSoft Inc.

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
import { computed, inject, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { NOTIFICATIONS_KEY, NotificationsPlugin, VUEBUS_KEY, VueBusPlugin } from '@v1nt1248/3nclient-lib/plugins';
import { useAppStore } from '@/common/store/app.store';
import { useAppsStore } from '@/common/store/apps.store';
import type { GlobalEvents } from '@/common/types';

export type AppViewInstance = ReturnType<typeof useAppPage>;

export function useAppPage() {
  const { t } = useI18n();
  const appStore = useAppStore();
  const { appVersion, user, connectivityStatus, appElement, customLogoSrc } = storeToRefs(appStore);

  const appsStore = useAppsStore();
  const { restart, applicationsInSystem, platform } = storeToRefs(appsStore);
  const {
    checkAndInstallAllUpdates,
    updateAppsAndLaunchersInfo,
    fetchCachedInfo,
    checkForAllUpdates,
    addAppPackFromFile,
    isFirstTimeOpened,
    installBundledAppsIntoNewSystem,
  } = appsStore;

  const { $emitter } = inject<VueBusPlugin<GlobalEvents>>(VUEBUS_KEY)!;
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  const openUsers = ref<string[]>([]);

  const checkProcIsOn = ref(false);

  const connectivityStatusText = computed(() =>
    connectivityStatus.value === 'online' ? 'app.status.online' : 'app.status.offline',
  );

  const needPlatformRestartAfterUpdate = computed(() => !!restart.value?.platform);

  async function onUserMenuOpen(addYourself?: boolean) {
    const users = await w3n.system.otherOpenUsers?.list();
    openUsers.value = users || [];

    if (addYourself) {
      openUsers.value.unshift(user.value);
    }
  }

  async function runAction(action: string) {
    switch (action) {
      case 'logout': {
        if (!w3n.system.logout || !w3n.system.userLogin) {
          return;
        }
        await w3n.system.userLogin.removeAutoLogin();
        return w3n.system.logout();
      }

      case 'add': {
        if (w3n.system.otherOpenUsers?.openLogin) {
          return w3n.system.otherOpenUsers.openLogin();
        }

        return;
      }

      case 'exit': {
        if (w3n.system.exitPlatform) {
          return w3n.system.exitPlatform();
        }

        return;
      }

      default: {
        console.log('user: ', action);
        if (w3n.system.otherOpenUsers?.openDashboardOf) {
          return w3n.system.otherOpenUsers.openDashboardOf(action);
        }

        return;
      }
    }
  }

  async function checkForUpdate() {
    try {
      checkProcIsOn.value = true;
      $createNotice({
        content: t('update_check.start'),
        type: 'info',
      });
      await checkForAllUpdates(true);
      let numOfUpdates = applicationsInSystem.value.filter(app => !!(app.updates || app.updateFromBundle)).length;
      if (platform.value.availableUpdates) {
        numOfUpdates += 1;
      }
      const content =
        numOfUpdates > 0
          ? t('update_check.updates_found', { numOfUpdates: `${numOfUpdates}` })
          : t('update_check.no_updates');
      $createNotice({ content, type: 'success' });
    } finally {
      checkProcIsOn.value = false;
    }
  }

  $emitter.once('init-setup:start', ev =>
    $createNotice({
      content: t('system.init_setup_start', {
        appsList: ev.bundledAppsForInstall.join(', '),
      }),
      type: 'info',
    }),
  );

  $emitter.once('init-setup:done', () =>
    $createNotice({
      content: t('system.init_setup_done'),
      type: 'success',
    }),
  );

  function quitAndInstall() {
    w3n.system!.platform!.downloader?.quitAndInstall();
  }

  function triggerOnStart(): void {
    // trigger, but don't wait here
    fetchCachedInfo().then(async () => {
      if (await isFirstTimeOpened()) {
        // setup autologin on this first run, while intial apps installation process
        await updateAppsAndLaunchersInfo();
        await installBundledAppsIntoNewSystem();
      } else {
        await updateAppsAndLaunchersInfo();
      }
      if (connectivityStatus.value === 'online') {
        await checkAndInstallAllUpdates();
      }
    });
  }

  async function addAppFromFile() {
    const filesWithApps = await w3n.shell!.fileDialogs!.openFileDialog!('Choose 3NWeb App file', 'Add App', true, {
      filters: [{ name: '', extensions: ['3nw', '3nweb', 'zip'] }],
    });
    if (!filesWithApps) {
      return;
    }
    for (const file of filesWithApps) {
      await addAppPackFromFile(file);
    }
  }

  async function doBeforeMount() {
    try {
      await Promise.all([appStore.initialize(), appsStore.initialize()]);

      triggerOnStart();
    } catch (e) {
      console.error('App view mounting error:', e);
      throw e;
    }
  }

  function doBeforeUnmount() {
    appStore.stopWatching();
  }

  return {
    t,
    appVersion,
    appElement,
    connectivityStatus,
    connectivityStatusText,
    customLogoSrc,
    needPlatformRestartAfterUpdate,
    checkProcIsOn,
    user,
    openUsers,

    onUserMenuOpen,
    runAction,
    quitAndInstall,
    checkForUpdate,
    addAppFromFile,

    doBeforeMount,
    doBeforeUnmount,
  };
}
