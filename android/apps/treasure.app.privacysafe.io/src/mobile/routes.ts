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
import { createRouter, createWebHashHistory, RouteRecordRaw } from 'vue-router';
import { APP_ROUTES } from '@/common/constants';
import RecordList from '@/mobile/pages/record-list.vue';
import Record from '@/mobile/pages/record.vue';
import Group from '@/mobile/pages/group.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/record-list' },
  { path: '/index.html', redirect: '/record-list' },
  { path: '/record-list', name: APP_ROUTES.RECORD_LIST, component: RecordList },
  { path: '/record/:id', name: APP_ROUTES.RECORD, component: Record },
  { path: '/group/:id?', name: APP_ROUTES.GROUP, component: Group },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
