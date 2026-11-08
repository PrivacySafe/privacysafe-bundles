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

import { itCond } from '../libs-for-tests/jasmine-utils.js';
import { areAddressesEqual } from '@shared/address-utils.js';
import { AppViewInstance } from '@main/common/composables/useAppView.ts';
import { TestSetupContainer } from '@tests/setups.js';

declare const w3n: web3n.testing.CommonW3N;

describe(`App view`, () => {

  let appView: AppViewInstance;
  let fstUserAddr: string;

  beforeAll(() => {
    ({
			fstUserAddr, appView
		} = (window as any as TestSetupContainer).testSetup);
  });

  itCond(`contains global datum`, async () => {
    expect(areAddressesEqual(
      appView.me.value,
      fstUserAddr
    )).withContext(`user id/address`).toBeTrue();
    expect(
      typeof appView.appVersion.value
    ).withContext(`application version`).toBe('string');
    expect(
      typeof appView.connectivityStatusText.value
    ).withContext(`online connectivity status`).toBe('string');
  });

});
