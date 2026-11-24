/*
 Copyright (C) 2024 3NSoft Inc.

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
import { makeServiceCaller } from '@shared/ipc/ipc-service-caller';
import type { ContactsDenoSrvInternal } from '@deno/types';
import { connectToContactsService } from './connect-with-retries';

export let appContactsSrvProxy: ContactsDenoSrvInternal;

/**
 * Why the service could not be reached at start-up, when it could not. The
 * window asks for it rather than making attempts of its own: that would double
 * the wait for an answer already known.
 */
export let servicesInitError: unknown;

/**
 * @param quiet leaves a failure out of the log. For the window's reconnection
 * loop, which retries for as long as the window is open: one line per attempt
 * would bury everything else, and the first failure is logged already.
 */
export async function initializeServices({ quiet }: { quiet?: boolean } = {}) {
  try {
    const srvConn = await connectToContactsService();
    appContactsSrvProxy = makeServiceCaller<ContactsDenoSrvInternal>(
      srvConn, [
        'addImage',
        'getImage',
        'deleteImage',

        'getContact',
        'upsertContact',
        'deleteContact',
        'getContactList',
        'getContactBlacklist',
        'checkAddressReachability',
        'changeContactBlockingSettings',

        'getTutorialState',
        'saveTutorialState',

        'getAppSettings',
        'saveAppSettings',

        'createBackupArchive',
        'cancelBackupArchive',
        'validateBackupArchive',
        'restoreBackupArchive',

        'checkChatWithPeer',
        'shareContacts',
        'cancelShareContacts',
        'getSharedContactsImport',
        'finishSharedContactsImport',

        'removeUnnecessaryImageFiles',
        'initialSyncProcess',
        'getServerReachability',
      ],
      ['watchContactBlacklistChanging'],
    ) as ContactsDenoSrvInternal;

    console.info('<- SERVICES ARE INITIALIZED ->');
  } catch (e) {
    servicesInitError = e;
    // Deliberately swallowed, and that is load-bearing: main.ts mounts the app
    // in the .then() of this call, so a rethrow would leave no window at all -
    // and no way to tell the user why. The window's own mounting handler asks
    // what went wrong and reports it; see reportWhyServiceIsUnavailable in
    // useAppView. Kept at `info` for that reason, and routed through w3n.log
    // rather than the console, which never reaches the platform's log files.
    if (!quiet) {
      await w3n.log(
        'info', 'Contacts service is not available at start-up; the window reports the reason', e,
      );
    }
  }
}
