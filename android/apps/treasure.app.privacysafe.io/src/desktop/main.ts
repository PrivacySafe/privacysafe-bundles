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
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  dialogs,
  notifications,
  storeDialogs,
  storeNotifications,
  theme,
  vueBus,
  storeVueBus,
} from '@v1nt1248/3nclient-lib/plugins';

import i18n from '@/common/i18n';
import { piniaRouter } from '@/common/plugins/pinia-router';
import { router } from './routes';
import { initializeServices } from '@/common/services/service-provider';

import '@v1nt1248/3nclient-lib/variables.css';
import '@v1nt1248/3nclient-lib/style.css';
import '@/assets/styles/main.css';

import App from '@/desktop/pages/app.vue';

initializeServices()
  .then(() => {
    const pinia = createPinia();
    pinia.use(piniaRouter);
    pinia.use(storeVueBus);
    pinia.use(storeDialogs)
    pinia.use(storeNotifications)

    const app = createApp(App);

    app.config.globalProperties.$router = router;
    app.config.compilerOptions.isCustomElement = tag => {
      return tag.startsWith('ui3n-');
    };

    dayjs.extend(relativeTime);

    app
      // The launcher decides the theme; this is only the value shown until its
      // settings have been read.
      .use(theme, { theme: 'dark' })
      .use(pinia)
      .use(i18n)
      .use(vueBus)
      .use(dialogs)
      .use(notifications)
      .use(router)
      .mount('#main');
  })
  .catch(err => console.error('🔥 ERROR CREATE APP. ', err));
