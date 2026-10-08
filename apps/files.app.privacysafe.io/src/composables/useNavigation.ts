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
import { computed, type ComputedRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { APP_ROUTES } from '@shared/constants';
import { useFsStore } from '@/store';
import type { RouteSingle, RouteDouble, ListingEntryExtended } from '@shared/types';

export function useNavigation() {
  const route = useRoute();
  const router = useRouter();

  const { fsFolderList } = storeToRefs(useFsStore());

  const isSplittedMode = computed(() => route.name === APP_ROUTES.DOUBLE);
  const isTileView = computed(() => route.query.view === 'tile');
  const activeWindow = computed(() => {
    if (isSplittedMode.value) {
      const { activeWindow = '1' } = route.query as RouteDouble['query'];
      return activeWindow;
    }

    return '1';
  }) as ComputedRef<'1' | '2'>;

  const window1RootFolderId = computed(() => route.params.rootFolderId as string);
  const window1FsId = computed(() => {
    if (!window1RootFolderId.value) {
      return null;
    }

    const currentRootFolder = fsFolderList.value.find(f => f.id === window1RootFolderId.value);
    if (!currentRootFolder) {
      return null;
    }

    return currentRootFolder.fsId;
  });

  const window1FolderPath = computed(() => route.query.path as string);
  const window1SortBy = computed(() => (route.query.sortBy || 'type') as keyof ListingEntryExtended);
  const window1SortOrder = computed(() => (route.query.sortOrder || 'desc') as 'asc' | 'desc');

  const window2RootFolderId = computed(() => {
    if (isSplittedMode.value) {
      return route.params.rootFolder2Id as string;
    }

    return null;
  });
  const window2FsId = computed(() => {
    if (!window2RootFolderId.value) {
      return null;
    }

    const currentRootFolder = fsFolderList.value.find(f => f.id === window2RootFolderId.value);
    if (!currentRootFolder) {
      return null;
    }

    return currentRootFolder.fsId;
  });
  const window2FolderPath = computed(() => {
    if (isSplittedMode.value) {
      return route.query.path2 as string;
    }

    return null;
  });
  const window2SortBy = computed(() => (route.query.sort2By || 'type') as keyof ListingEntryExtended);
  const window2SortOrder = computed(() => (route.query.sort2Order || 'desc') as 'asc' | 'desc');

  async function navigateToRouteSingle({
    params,
    query,
  }: {
    params?: Partial<RouteSingle['params']>;
    query?: Partial<RouteSingle['query']>;
  }) {
    const { rootFolderId } = route.params as RouteSingle['params'];
    const { view = 'table', path = '', sortBy = 'type', sortOrder = 'desc' } = route.query as RouteSingle['query'];

    const newRouterData: RouteSingle = {
      name: APP_ROUTES.SINGLE,
      params: {
        rootFolderId: params?.rootFolderId || rootFolderId,
      },
      query: {
        view: query?.view || view,
        activeWindow: '1',
        path: query?.path ? query?.path : query?.path === '' ? '' : path,
        sortBy: query?.sortBy || sortBy,
        sortOrder: query?.sortOrder || sortOrder,
      },
    };

    return router.push(newRouterData);
  }

  async function navigateToRouteDouble({
    params,
    query,
  }: {
    params?: Partial<RouteDouble['params']>;
    query?: Partial<RouteDouble['query']>;
  }) {
    const { rootFolderId, rootFolder2Id } = route.params as RouteDouble['params'];
    const {
      view = 'table',
      activeWindow = '1',
      path = '',
      path2 = '',
      sortBy = 'type',
      sort2By = 'type',
      sortOrder = 'desc',
      sort2Order = 'desc',
    } = route.query as RouteDouble['query'];

    const newRouterData: RouteDouble = {
      name: APP_ROUTES.DOUBLE,
      params: {
        rootFolderId: params?.rootFolderId || rootFolderId,
        rootFolder2Id: params?.rootFolder2Id || rootFolder2Id,
      },
      query: {
        view: query?.view || view,
        activeWindow: query?.activeWindow || activeWindow,
        path: query?.path ? query?.path : query?.path === '' ? '' : path,
        sortBy: query?.sortBy || sortBy,
        sortOrder: query?.sortOrder || sortOrder,
        path2: query?.path2 ? query?.path2 : query?.path2 === '' ? '' : path2,
        sort2By: query?.sort2By || sort2By,
        sort2Order: query?.sort2Order || sort2Order,
      },
    };

    return router.push(newRouterData);
  }

  async function selectActiveWindow(val: 1 | '1' | 2 | '2') {
    if (activeWindow.value !== `${val}`) {
      await navigateToRouteDouble({
        query: { activeWindow: `${val}` },
      });
    }
  }

  return {
    route,
    router,
    isSplittedMode,
    isTileView,
    activeWindow,
    window1FsId,
    window1RootFolderId,
    window1FolderPath,
    window1SortBy,
    window1SortOrder,
    window2FsId,
    window2RootFolderId,
    window2FolderPath,
    window2SortBy,
    window2SortOrder,
    navigateToRouteSingle,
    navigateToRouteDouble,
    selectActiveWindow,
  };
}
