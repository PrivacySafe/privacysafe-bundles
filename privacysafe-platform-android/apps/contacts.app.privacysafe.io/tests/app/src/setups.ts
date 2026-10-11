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
/* eslint-disable @typescript-eslint/no-explicit-any */
import { defineComponent } from 'vue';
import { setupMainApp } from '@main/desktop/app-setup';
import { initializeServices } from '@main/common/services/services-provider';
import { type ContactsStore, useContactsStore } from '@main/common/store/contacts.store';
import { AppViewInstance, useAppView } from '@main/common/composables/use-app-view';

declare const w3n: web3n.testing.CommonW3N;

export interface TestSetupContainer extends Window {
  testSetup: {
    fstUserAddr: string;
    sndUserAddr: string;
    appView: AppViewInstance;
    contactsStore: ContactsStore;
  } & ReturnType<typeof setupMainApp>;
}

export async function setupBeforeAllTests(): Promise<void> {
	await initializeServices();

  // useAppView() reaches for useI18n(), and vue-i18n refuses to run anywhere
  // but at the top of a component setup — outside one it throws
  // MUST_BE_CALL_SETUP_TOP (error code 26). So the composables are created in
  // the setup of a probe root that is mounted with the app's real plugin
  // wiring: pinia, i18n, vueBus, dialogs, notifications and the router.
  let appView: AppViewInstance;
  let contactsStore: ContactsStore;
  const Probe = defineComponent({
    setup() {
      appView = useAppView();
      contactsStore = useContactsStore();
      return () => null;
    },
  });

  const { app, router } = setupMainApp(Probe);
  const mountPoint = document.createElement('div');
  mountPoint.id = 'test-app-root';
  document.body.appendChild(mountPoint);
  app.mount(mountPoint);

  await appView!.doBeforeMount();

  const fstUserAddr = await w3n.testStand.idOfTestUser(1);
  const sndUserAddr = await w3n.testStand.idOfTestUser(2);

  (window as any as TestSetupContainer).testSetup = {
    app, router, appView: appView!, fstUserAddr, sndUserAddr,
    contactsStore: contactsStore!
  };
}
