/*
 Copyright (C) 2025 - 2026 3NSoft Inc.

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

import '@v1nt1248/3nclient-lib/variables.css';
import '@v1nt1248/3nclient-lib/style.css';
import '@/common/assets/styles/main.css';

import i18n from '@/common/data/i18';

import App from '@sys-map/pages/map.vue';
import { createPinia } from 'pinia';
import { dialogs, notifications, storeNotifications, vueBus } from '@v1nt1248/3nclient-lib/plugins';

function initialApp() {
  try {
    const pinia = createPinia();
    pinia.use(storeNotifications);

    const app = createApp(App);
    app.config.compilerOptions.isCustomElement = tag => {
      return tag.startsWith('ui3n-');
    };

    app.use(pinia).use(i18n).use(vueBus).use(dialogs).use(notifications);
    app.mount('#map');
  } catch (err) {
    console.error('🔥 ERROR CREATE APP. ', err);
  }
}

initialApp();
