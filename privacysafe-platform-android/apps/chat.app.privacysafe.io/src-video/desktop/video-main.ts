/*
 Copyright (C) 2024 - 2025 3NSoft Inc.

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

import { createApp } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import { createPinia } from 'pinia';
import { dialogs, notifications, storeVueBus, theme, vueBus } from '@v1nt1248/3nclient-lib/plugins';

import '@v1nt1248/3nclient-lib/variables.css';
import '@v1nt1248/3nclient-lib/style.css';
import '@main/common/assets/styles/main.css';

import i18n from '@main/common/data/i18';
import { initDebugLogging } from '@shared/logger';
import { startCallWindowLogRelay } from '@video/common/services/video-chat-service/video-chat-srv';
import { installConsoleTimestamps } from '@shared/console-timestamps';

import VideoApp from '@video/desktop/pages/video-app.vue';
import VASetup from '@video/desktop/pages/va-setup.vue';
import Call from '@video/desktop/pages/call/call.vue';

// Before anything else logs: a call window's console lines are only useful with
// a time on them (see shared-libs/console-timestamps.ts).
installConsoleTimestamps();

const app = createApp(VideoApp);
const pinia = createPinia();
pinia.use(storeVueBus);

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/va-setup' },
    { path: '/video-chat.html', redirect: '/va-setup' },
    {
      name: 'va-setup',
      path: '/va-setup',
      component: VASetup,
    },
    {
      name: 'call',
      path: '/call',
      component: Call,
    },
  ],
});

app.config.globalProperties.$router = router;
app.config.compilerOptions.isCustomElement = tag => {
  return tag.startsWith('ui3n-');
};

app
  .use(theme, { theme: 'dark' })
  .use(pinia).use(i18n).use(vueBus).use(dialogs).use(notifications).use(router).mount('#video-main');

// Diagnostic logging of signalling and track handling, off unless the
// launcher's app configuration turns it on (see shared-libs/logger.ts).
initDebugLogging();

// This window's lines also go to the background, which prints them into the
// output the whole run is read from. Started here, before the background has
// subscribed to this window: lines written meanwhile wait in the relay.
startCallWindowLogRelay();
