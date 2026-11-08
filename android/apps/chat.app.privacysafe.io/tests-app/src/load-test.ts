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
import TestApp from '@tests/test-app.vue';
import RoutedComponent from '@tests/test-routed-component.vue';
import { setupMainApp } from '@tests/app-setup';
import { createRouter, createWebHashHistory } from 'vue-router';
import { initializeServices } from '@main/common/services/external-services';
import { defer } from '@tests/lib-common/processes/deferred';
import { stringifyErr } from '@tests/lib-common/exceptions/error';
import { logErr } from './test-page-utils';
import { removeInboxLeftoversOfEarlierRuns } from '@tests/libs-for-tests/inbox-cleanup';

// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
const { promise, reject, resolve } = defer<void>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).preTestProc = promise;

const routerForTestApp = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/test-route' },
    { path: '/index.html', redirect: '/test-route' },
    {
      path: '/test-route',
      name: 'test',
      component: RoutedComponent
    }
  ]
});

// The inbox first: see removeInboxLeftoversOfEarlierRuns for why, and why it
// has to happen before initializeServices() starts the background component.
removeInboxLeftoversOfEarlierRuns()
.then(() => initializeServices())
.then(() => {
  const app = createApp(TestApp, { reject, resolve });
  setupMainApp(app, routerForTestApp);
  app.mount(`#test-app-vue`);
})
.catch(err => {
  // The reason goes into the message itself: the stand's log serializes the
  // error argument with JSON.stringify, and an RPC exception comes out of that
  // as `{}` - which is exactly what the run of 2026-08-14 printed instead of
  // naming the service that timed out.
  logErr(`Failed to initialize test app: ${stringifyErr(err)}`, err);
  reject(err);
});
