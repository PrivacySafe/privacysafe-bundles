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
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { router } from './router';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  theme,
  dialogs,
  notifications,
  storeDialogs,
  storeVueBus,
  storeNotifications,
  vueBus,
} from '@v1nt1248/3nclient-lib/plugins';
import { piniaRouter } from '@common/plugins/pinia-router';
import { initializationServices } from '@common/services/services-provider';
import { showStartupFailure } from '@common/utils/startup-failure';
import { setupGlobalReportingOfUnhandledErrors } from '@shared/utils/error-handling';
import { initDebugLogging, makeLogger } from '@shared/utils/logger';

import App from '@desktop/pages/app.vue';

import '@v1nt1248/3nclient-lib/variables.css';
import '@v1nt1248/3nclient-lib/style.css';
import '@common/assets/styles/main.css';

import i18n from '@common/data/i18';

const log = makeLogger('MainWindow');

// Platform exceptions are plain objects without a `message`, so an unhandled
// rejection leaves nothing readable in devtools. This puts them into w3n.log.
setupGlobalReportingOfUnhandledErrors();

const init = () => {
  initializationServices()
    .then(async () => {
      initDebugLogging();

      const pinia = createPinia();
      pinia.use(piniaRouter);
      pinia.use(storeVueBus);
      pinia.use(storeDialogs);
      pinia.use(storeNotifications);

      const app = createApp(App);

      app.config.globalProperties.$router = router;
      // app.config.globalProperties.$store = store
      app.config.compilerOptions.isCustomElement = tag => {
        return tag.startsWith('ui3n-');
      };

      dayjs.extend(relativeTime);

      app
        .use(theme, { theme: 'dark' })
        .use(pinia)
        .use(i18n)
        .use(vueBus)
        .use(dialogs)
        .use(notifications)
        .use(router)
        .mount('#main');
    })
    .catch(err => {
      // Without this the failure is an unhandled rejection and a splash animating
      // over a window that will never load: nothing on screen says why.
      log.error(`App is not started, as its services could not be reached`, err);
      showStartupFailure('main');
    });
};

init();
