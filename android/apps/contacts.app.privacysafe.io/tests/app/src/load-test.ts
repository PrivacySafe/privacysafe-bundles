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

import { addMsgToPage, ClosingParams } from './test-page-utils.js';
import { setupBeforeAllTests } from './setups.js';

declare const w3n: web3n.testing.CommonW3N;

(async () => {

	(window as any).preTestProc = setupBeforeAllTests()
	.then(() => {
		(window as any).preTestProc = undefined;
	});

	const { userId, userNum } = await w3n.testStand.staticTestInfo();
	if (userNum === 1) {
		setTimeout(() => w3n.testStand.focusThisWindow!(), 1000);
		(window as any).closeW3NAfterTests = {
			waitSecs: 15
		} as ClosingParams;
		addMsgToPage(`1️⃣  Main test user '${userId}'`);
		document.getElementById('cancel-autoclose')!.hidden = false;
		await import('./tests/app-view.js');
		await import('./tests/contacts-store.js');
		await import('./tests/contacts-service.js');
		await import('./tests/synced-fs.js');
		await import('./tests/routing.js');
	} else if (userNum === 2) {
		(window as any).skipW3NTests = true;
		addMsgToPage(`2️⃣  Secondary test user '${userId}'`);
		w3n.closeSelf();
	} else {
		// we expect only two test users
		addMsgToPage(`💥 we don't expect any other user. Correct either this code, or settings`);
	}
})();
