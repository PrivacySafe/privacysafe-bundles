/*
 Copyright (C) 2020 - 2025 3NSoft Inc.

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
import Chats from '@main/mobile/pages/chats.vue';
import Chat from '@main/mobile/pages/chat.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/chats' },
  { path: '/index-mobile.html', redirect: '/chats' },
  {
    path: '/chats',
    name: 'chats',
    component: Chats,
  },
  {
    path: '/chat/:chatType/:chatId',
    name: 'chat',
    component: Chat,
  }
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
