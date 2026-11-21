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

import { itCond } from '../libs-for-tests/jasmine-utils.js';
import { chatService } from '@main/common/services/external-services.ts';

describe(`App Device ID`, () => {

  itCond(`should return non-empty string`, async () => {
    const deviceId = await chatService.getAppDeviceId();
    expect(deviceId)
      .withContext(`appDeviceId should be truthy`)
      .toBeTruthy();
    expect(typeof deviceId)
      .withContext(`appDeviceId should be a string`)
      .toBe('string');
    expect(deviceId.length)
      .withContext(`appDeviceId should not be empty`)
      .toBeGreaterThan(0);
  });

  itCond(`should have valid format (prefix-randomString)`, async () => {
    const deviceId = await chatService.getAppDeviceId();
    // Expected format: prefix-20chars (e.g., "desktop-abc123..." or "app-abc123...")
    // The random string is 20 characters long
    const deviceIdPattern = /^[a-zA-Z0-9]+-[a-zA-Z0-9]+$/;
    expect(deviceId)
      .withContext(`appDeviceId should match format "prefix-randomString", got: ${deviceId}`)
      .toMatch(deviceIdPattern);
  });

  itCond(`should be persistent across multiple calls`, async () => {
    const deviceId1 = await chatService.getAppDeviceId();
    const deviceId2 = await chatService.getAppDeviceId();
    const deviceId3 = await chatService.getAppDeviceId();

    expect(deviceId1)
      .withContext(`first and second call should return same ID`)
      .toBe(deviceId2);
    expect(deviceId2)
      .withContext(`second and third call should return same ID`)
      .toBe(deviceId3);
  });

  itCond(`is the id every phantom of this device carries`, async () => {
    // The id is what tells a phantom of this device from one of another, and
    // there is exactly one way that goes wrong in practice: two app instances on
    // one data folder read the same file, get the same id, and then skip every
    // phantom as their own. Neither this spec nor any other can see that from
    // inside one instance - the guard is startForeignInstanceWatch() plus the id
    // printed at start-up - so what is pinned here is the invariant that makes
    // both possible: one device, one stable id, exposed to the GUI.
    const deviceId = await chatService.getAppDeviceId();

    expect(deviceId.includes('-'))
      .withContext(`'${deviceId}' should be a form factor and a random part`)
      .toBe(true);
    expect(deviceId.split('-')[1].length)
      .withContext(`the random part should be long enough not to collide`)
      .toBeGreaterThan(15);
  });

  itCond(`should be accessible via app store`, async () => {
    // Dynamically import to avoid circular dependencies
    const { useAppStore } = await import('@main/common/store/app.store.ts');
    const appStore = useAppStore();

    // Initialize the store if not already initialized
    if (!appStore.appDeviceId) {
      await appStore.initialize();
    }

    const storeDeviceId = appStore.appDeviceId;
    const serviceDeviceId = await chatService.getAppDeviceId();

    expect(storeDeviceId)
      .withContext(`app store should have appDeviceId`)
      .toBeTruthy();
    expect(storeDeviceId)
      .withContext(`app store deviceId should match chatService deviceId`)
      .toBe(serviceDeviceId);
  });

});