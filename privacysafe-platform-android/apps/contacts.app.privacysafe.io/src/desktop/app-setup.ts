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
import { createApp, type Component } from 'vue';
import { createPinia } from 'pinia';
import { router } from './router';
import { theme, dialogs, notifications, vueBus } from '@v1nt1248/3nclient-lib/plugins';
import { piniaRouter } from '@main/common/plugins/pinia-router';
import i18n from '@main/common/data/i18';

import App from '@main/desktop/pages/app.vue';

/**
 * @param rootComponent lets the test harness mount a probe root with the app's
 * real plugin wiring, instead of the whole UI. Defaults to the app itself.
 */
export function setupMainApp(rootComponent: Component = App) {
  const pinia = createPinia();
  pinia.use(piniaRouter);

  const app = createApp(rootComponent);
  app.provide('isMobileMode', false);

  app.config.globalProperties.$router = router;
  app.config.compilerOptions.isCustomElement = tag => {
    return tag.startsWith('ui3n-');
  };

  app.use(theme, { theme: 'dark' }).use(pinia).use(i18n).use(vueBus).use(dialogs).use(notifications).use(router);

  return { app, router };
}
