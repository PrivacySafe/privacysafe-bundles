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
import { SYSTEM_FOLDERS } from '@common/constants';
import MailFolder from '@mobile/pages/mail-folder/mail-folder.vue';
import Message from '@mobile/pages/message/message.vue';
import Report from '@mobile/pages/report/report.vue';

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: `/folder/${SYSTEM_FOLDERS.inbox}` },
  { path: '/index-mobile.html', redirect: `/folder/${SYSTEM_FOLDERS.inbox}` },
  {
    path: '/folder/:folderId',
    name: 'folder',
    component: MailFolder,
  },
  {
    path: '/message/:msgId',
    name: 'message',
    component: Message,
  },
  {
    path: '/report/:msgId',
    name: 'report',
    component: Report,
  }
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});
