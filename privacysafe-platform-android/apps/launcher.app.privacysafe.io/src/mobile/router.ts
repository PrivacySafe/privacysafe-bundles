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
import MyApps from '@/mobile/pages/my-apps/my-apps.vue';
import AppStore from '@/mobile/pages/app-store/app-store.vue';
import Updates from '@/mobile/pages/updates/updates.vue';
import Settings from '@/mobile/pages/settings/settings.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/my-apps' },
  { path: '/index-mobile.html', redirect: '/my-apps' },
  {
    path: '/my-apps',
    name: 'my-apps',
    component: MyApps,
  },
  {
    path: '/updates',
    name: 'updates',
    component: Updates,
  },
  {
    path: '/app-store',
    name: 'app-store',
    component: AppStore,
  },
  {
    path: '/settings',
    name: 'settings',
    component: Settings,
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
