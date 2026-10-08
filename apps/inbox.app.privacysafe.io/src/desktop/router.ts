/*
 Copyright (C) 2024-2025 3NSoft Inc.

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
import Home from '@desktop/pages/home.vue';
import Inbox from '@desktop/pages/inbox/inbox.vue';
import Sent from '@desktop/pages/sent/sent.vue';
import Outbox from '@desktop/pages/outbox/outbox.vue';
import Draft from '@desktop/pages/draft/draft.vue';
import Trash from '@desktop/pages/trash/trash.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/home/inbox' },
  { path: '/index.html', redirect: '/home/inbox' },
  {
    path: '/home',
    name: 'home',
    component: Home,
    children: [
      { path: 'inbox', name: 'inbox', component: Inbox },
      { path: 'sent', name: 'sent', component: Sent },
      { path: 'outbox', name: 'outbox', component: Outbox },
      { path: 'draft', name: 'draft', component: Draft },
      { path: 'trash', name: 'trash', component: Trash },
    ]
  },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
