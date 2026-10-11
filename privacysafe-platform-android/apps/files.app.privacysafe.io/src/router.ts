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
import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router';
import { APP_ROUTES } from '@shared/constants';
import Dashboard from '@/pages/dashboard/dashboard.vue';
import FsFolder from '@/pages/fs-folder/fs-folder.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/dashboard/single/user-synced-root' },
  { path: '/index.html', redirect: '/dashboard/single/user-synced-root' },
  {
    path: '/dashboard',
    name: APP_ROUTES.DASHBOARD,
    component: Dashboard,
    children: [
      {
        path: 'single/:rootFolderId',
        name: APP_ROUTES.SINGLE,
        component: FsFolder,
      },
      {
        path: 'double/:rootFolderId/:rootFolder2Id',
        name: APP_ROUTES.DOUBLE,
        components: {
          default: FsFolder,
          second: FsFolder,
        },
      },
    ],
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
