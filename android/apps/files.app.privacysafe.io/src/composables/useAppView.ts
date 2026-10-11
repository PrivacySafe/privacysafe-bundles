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
import { computed, defineAsyncComponent, inject, onBeforeMount, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import hasIn from 'lodash/hasIn';
import isEmpty from 'lodash/isEmpty';
import { useAppStore, useFsStore, useSyncQueueStore, useFavoriteStore } from '@/store';
import {
  DIALOGS_KEY,
  THEME_KEY,
  VUEBUS_KEY,
  type DialogsPlugin,
  type ThemePlugin,
  type VueBusPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import type { Ui3nResizeCbArg } from '@v1nt1248/3nclient-lib';
import { makeServiceCaller } from '@shared/utils/ipc/ipc-service-caller';
import {
  AppGlobalEvents,
  StorageConnectionStatusEvent,
  StorageEventPayloadWithPath,
  StorageFavoritesUpdateEvent,
} from '@shared/types';
import type { StorageAppDenoService } from '@deno/types';
import forEach from 'lodash/forEach';
import { appStorageSrv } from '@/services/services-provider.ts';
import { STUCK_SYNCHRONIZATION_TIME_CHECKING } from '@shared/constants';

export function useAppView() {
  const { t, locale } = useI18n();
  const { $emitter } = inject<VueBusPlugin<AppGlobalEvents>>(VUEBUS_KEY)!;
  const { $openDialog } = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const { setTheme } = inject<ThemePlugin>(THEME_KEY)!;

  const fsStore = useFsStore();

  const appStore = useAppStore();
  const {
    appVersion,
    user: me,
    connectivityStatus,
    commonLoading,
    customLogoSrc,
    lang,
    colorTheme,
  } = storeToRefs(appStore);
  const {
    getAppStorageSettings,
    readAndStartWatchingAppConfig,
    stopWatchingAppConfig,
    getAppVersion,
    getUser,
    getConnectivityStatus,
    setConnectivityStatus,
    setAppWindowSize,
  } = appStore;

  const syncQueueStore = useSyncQueueStore();
  const { downloadProcesses, uploadProcesses, syncQueue } = storeToRefs(syncQueueStore);
  const {
    onUpdateQueue,
    onUpsertQueueItem,
    onRemoveQueueItem,
    upsertProcess,
    removeProcess,
    getRootFolderSyncStatus,
  } = syncQueueStore;

  const { setFavoriteFolderListValue } = useFavoriteStore();

  const appElement = ref<HTMLDivElement | null>(null);

  const isFillingUpSyncQueue = ref(false);

  const connectivityTimerId = ref<ReturnType<typeof setInterval> | undefined>();

  const connectivityStatusText = computed(() =>
    connectivityStatus.value === 'online' ? 'app.status.online' : 'app.status.offline',
  );

  const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const { contentRect, target } = entry;
      const { className } = target;
      const { width, height } = contentRect;
      if (className === 'app') {
        setAppWindowSize({ width, height });
      }
    }
  });

  // Applying of the system level ui-settings is kept in one place: the store
  // holds values, while the theme plugin and i18n are driven by these watchers.
  watch(colorTheme, id => setTheme(id), { immediate: true });
  watch(lang, value => (locale.value = value), { immediate: true });

  w3n.connectivity?.isOnline().then(res => setConnectivityStatus(res.includes('online')));

  async function appExit() {
    w3n.closeSelf!();
  }

  async function openAppSettings() {
    const component = defineAsyncComponent(() => import('@/components/dialogs/app-settings.vue'));
    await $openDialog<undefined>(component, {
      dialogProps: {
        title: `${t('app.title')} ${t('app.settings.title')}`,
        icon: {
          icon: 'outline-settings',
          size: 16,
        },
        width: 560,
        cssStyle: { borderRadius: '24px', maxHeight: '95%' },
        contentCssStyle: { borderRadius: '24px' },
        confirmButton: false,
        cancelButton: false,
        closeOnClickOverlay: false,
      },
    });
  }

  function onResize(value: Ui3nResizeCbArg) {
    setAppWindowSize({ width: value.width, height: value.contentHeight });
  }

  let st1: ReturnType<typeof setInterval>;
  onBeforeMount(async () => {
    try {
      await fsStore.initializeFsItems();

      await getAppVersion();
      await getUser();
      await readAndStartWatchingAppConfig();
      await getConnectivityStatus();
      await getAppStorageSettings();

      const storageSrvConnection = await w3n.rpc!.thisApp!('AppStorageInternal');
      const storageSrv = makeServiceCaller(storageSrvConnection, [], ['watchEvent']) as StorageAppDenoService;
      storageSrv.watchEvent({
        next: async eventObj => {
          if (eventObj.event !== 'connectivity:change') {
            console.log('🔔 WATCH EVENT FROM DENO => ', JSON.stringify(eventObj));
          }

          const { event, payload } = eventObj;
          const path = hasIn(payload, 'path')
            ? (payload as StorageEventPayloadWithPath).path === '.'
              ? ''
              : (payload as StorageEventPayloadWithPath).path.replace('./', '')
            : null;

          switch (event) {
            case 'connectivity:change': {
              const { isOnline } = payload as StorageConnectionStatusEvent['payload'];
              setConnectivityStatus(isOnline);
              break;
            }

            case 'favorites:update': {
              const { favorites } = payload as StorageFavoritesUpdateEvent['payload'];
              setFavoriteFolderListValue(favorites);
              break;
            }

            case 'sync_queue:update': {
              const { syncQueue } = payload;
              onUpdateQueue(Object.values(syncQueue));
              isFillingUpSyncQueue.value = !isEmpty(syncQueue.value);
              break;
            }

            case 'sync_queue:item:add': {
              const { item } = payload;
              onUpsertQueueItem(item);
              isFillingUpSyncQueue.value = !isEmpty(syncQueue.value);
              break;
            }

            case 'sync_queue:item:remove': {
              const { path } = payload;
              onRemoveQueueItem(path);
              isFillingUpSyncQueue.value = !isEmpty(syncQueue.value);
              break;
            }

            case 'sync_queue:item:update': {
              const { item } = payload;
              onUpsertQueueItem(item);
              isFillingUpSyncQueue.value = !isEmpty(syncQueue.value);
              break;
            }

            case 'upload:start': {
              upsertProcess({ action: 'upload', path: path!, value: 0 });
              break;
            }

            case 'upload:progress': {
              upsertProcess({ action: 'upload', path: path!, value: payload.progress });
              break;
            }
            case 'upload:end': {
              removeProcess({ action: 'upload', path: path! });
              if ((!path && typeof path === 'string') || path === 'root') {
                await getRootFolderSyncStatus('root');
              } else if (path && path === fsStore.trashFolderName) {
                await getRootFolderSyncStatus('trash');
              }
              break;
            }

            case 'download:start': {
              upsertProcess({ action: 'download', path: path!, value: 0 });
              break;
            }

            case 'download:progress': {
              upsertProcess({ action: 'download', path: path!, value: payload.progress });
              break;
            }

            case 'download:end': {
              removeProcess({ action: 'download', path: path! });
              break;
            }

            case 'adoptRemote:start': {
              upsertProcess({ action: 'adoptRemote', path: path!, value: true });
              break;
            }

            case 'adoptRemote:end': {
              removeProcess({ action: 'adoptRemote', path: path! });
              if ((!path && typeof path === 'string') || path === 'root') {
                await getRootFolderSyncStatus('root');
              } else if (path && path === fsStore.trashFolderName) {
                await getRootFolderSyncStatus('trash');
              }
              if (payload.isNecessaryReread) {
                $emitter.emit('refresh:data', { path: path! });
              }
              break;
            }

            case 'arose:conflict': {
              if ((!path && typeof path === 'string') || path === 'root') {
                await getRootFolderSyncStatus('root');
              } else if (path && path === fsStore.trashFolderName) {
                await getRootFolderSyncStatus('trash');
              }

              if (
                (!path && typeof path === 'string') ||
                path === 'root' ||
                (path && path === fsStore.trashFolderName)
              ) {
                const component = defineAsyncComponent(
                  () => import('@/components/dialogs/resolve-conflicts-dialog/resolve-conflicts-dialog.vue'),
                );
                await $openDialog<boolean>(component, {
                  paths: [path || ''],
                  dialogProps: {
                    title: '',
                    width: 960,
                    cssStyle: { borderRadius: '24px' },
                    contentCssStyle: { borderRadius: '24px' },
                    confirmButton: false,
                    cancelButton: false,
                    closeOnClickOverlay: false,
                  },
                });
                $emitter.emit('refresh:data', { path: '', withoutVerify: true });
              }

              break;
            }

            case 'sync:error': {
              console.log('🔥 ERROR EVENT FROM DENO => ', payload);
              break;
            }
          }
        },
        error: e => w3n.log('error', '🔥 Error watching storage events. ', e),
        complete: () => storageSrvConnection.close(),
      });

      st1 = setInterval(() => {
        console.log('[*] Checking that there are no "stuck" synchronization operations [*]');
        forEach(Object.fromEntries(uploadProcesses.value), async (data, path) => {
          const { lastUpdate } = data;
          const diff = Date.now() - lastUpdate;
          if (diff > STUCK_SYNCHRONIZATION_TIME_CHECKING) {
            removeProcess({ action: 'upload', path });
            await appStorageSrv.deleteSyncQueueItem(path);
          }
        });

        forEach(Object.fromEntries(downloadProcesses.value), async (data, path) => {
          const { lastUpdate } = data;
          const diff = Date.now() - lastUpdate;
          if (diff > STUCK_SYNCHRONIZATION_TIME_CHECKING) {
            removeProcess({ action: 'download', path });
            await appStorageSrv.deleteSyncQueueItem(path);
          }
        });
      }, 60000);
    } catch (e) {
      console.error('🔥 Error while mounted the app. ', e);
      throw e;
    }
  });

  onMounted(() => {
    if (appElement.value) {
      const { width, height } = appElement.value.getBoundingClientRect();
      setAppWindowSize({ width, height });
      resizeObserver.observe(appElement.value as Element);
    }
  });

  onBeforeUnmount(() => {
    stopWatchingAppConfig();

    if (connectivityTimerId.value) {
      clearInterval(connectivityTimerId.value);
    }

    if (st1) {
      clearInterval(st1);
    }
  });

  return {
    appElement,
    appVersion,
    me,
    customLogoSrc,
    connectivityStatus,
    connectivityStatusText,
    commonLoading,
    isFillingUpSyncQueue,
    onResize,
    openAppSettings,
    appExit,
  };
}
