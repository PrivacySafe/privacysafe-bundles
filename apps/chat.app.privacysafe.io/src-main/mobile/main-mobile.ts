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

import { createApp } from 'vue';
import { dialogs, notifications, storeVueBus, storeNotifications, theme, vueBus } from '@v1nt1248/3nclient-lib/plugins';

import '@v1nt1248/3nclient-lib/variables.css';
import '@v1nt1248/3nclient-lib/style.css';
import '@main/common/assets/styles/main.css';

import { startMainWindow } from '@main/common/services/bootstrap';
import { startMainWindowLogRelay } from '@main/common/services/gui-log-relay';
import { installConsoleTimestamps } from '@shared/console-timestamps';
import { initDebugLogging } from '@shared/logger';
import { router } from './router';
import i18n from '@main/common/data/i18';

import App from '@main/mobile/pages/app.vue';
import { createPinia } from 'pinia';

// Before the services start logging: without a time on them, main-window lines
// cannot be lined up with the call window's or the background's (see
// shared-libs/console-timestamps.ts).
installConsoleTimestamps();

// Shared with the desktop entry point: see startMainWindow.
startMainWindow('mobile', () => {
  // Both need the services: the relay's channel is chatService, and the
  // diagnostic switch is read through the shell. Started before the app is
  // mounted, so that what the stores do on their way up is relayed too.
  startMainWindowLogRelay();
  initDebugLogging();

  const pinia = createPinia();
  pinia.use(storeVueBus);
  pinia.use(storeNotifications);

  const app = createApp(App);
  app.config.globalProperties.$router = router;
  app.config.compilerOptions.isCustomElement = tag => {
    return tag.startsWith('ui3n-');
  };

  app
    .use(theme, { theme: 'dark' })
    .use(pinia).use(i18n).use(vueBus).use(dialogs).use(notifications).use(router).mount('#mobile');
});
