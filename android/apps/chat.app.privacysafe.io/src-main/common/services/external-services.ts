/*
 Copyright (C) 2020, 2024 - 2025 3NSoft Inc.

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
import { fileStoreService } from '@deno/services/file-store-service/file-store-service.ts';
import { makeServiceCaller } from '@shared/ipc/ipc-service-caller';
import { sleep } from '@shared/processes/sleep';
import type { ChatSrvOverIPC, FileStoreService } from '@deno/types/index.ts';
import type { ContactsService, VideoGUIOpener } from '~/index.ts';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ExternalServices');

export let fileLinkStoreSrv: FileStoreService;
export let chatService: ChatSrvOverIPC;
export let videoOpenerSrv: VideoGUIOpener;

/**
 * Waits between attempts to reach the contacts app.
 *
 * The platform allows a service ten seconds from the spawn of its component to
 * `exposeService()`, and the contacts app exposes AppContacts only after its
 * whole start-up - synced storage, SQLite, an initial synchronization with the
 * server. On a loaded machine that does not fit, and the connect fails. The
 * component keeps starting after that, though, so a second attempt a few
 * seconds later connects at once - which is why one retry is worth more here
 * than any amount of patience in the first one.
 */
const CONTACTS_CONNECT_RETRY_DELAYS_MILLIS = [3_000, 10_000];

let contactsConn: Promise<ContactsService> | undefined = undefined;

async function connectToContactsApp(): Promise<ContactsService> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= CONTACTS_CONNECT_RETRY_DELAYS_MILLIS.length; attempt += 1) {
    if (attempt > 0) {
      await sleep(CONTACTS_CONNECT_RETRY_DELAYS_MILLIS[attempt - 1]);
    }
    try {
      const srvConn = await w3n.rpc!.otherAppsRPC!('contacts.app.privacysafe.io', 'AppContacts');
      return makeServiceCaller<ContactsService>(
        srvConn,
        [
          'getContact',
          'getContactByMail',
          'getContactList',
          'getContactBlacklist',
          'addContact',
          'upsertContact',
          'changeContactBlockingSettings',
        ],
        ['watchContactBlacklistChanging'],
      ) as ContactsService;
    } catch (err) {
      lastErr = err;
      log.info(
        `Attempt ${attempt + 1} to connect to the contacts app failed` +
          `${attempt < CONTACTS_CONNECT_RETRY_DELAYS_MILLIS.length ? '; will try again' : ''}`,
        err,
      );
    }
  }
  throw lastErr;
}

/**
 * The contacts service, connected on first use.
 *
 * Deliberately outside initializeServices(): this is the only service of
 * *another* app, and it is the only one this app cannot make answer quickly (the
 * services of this app answer from a facade before their work is done - see
 * facadeOver in src-deno/services/chat-service/ipc-expose.ts). Having it in the
 * start-up barrier made a slow contacts app stop this one from starting at all:
 * on 2026-08-14 every window of a test run died on it, and in production the
 * same failure leaves a blank window. Messaging, synchronization and calls do
 * not use contacts at all - only names in the UI do.
 *
 * A failed connect is not remembered, so the next use tries again.
 */
export function contactsSrv(): Promise<ContactsService> {
  if (!contactsConn) {
    contactsConn = connectToContactsApp().catch(err => {
      contactsConn = undefined;
      throw err;
    });
  }
  return contactsConn;
}

export async function initializeServices() {
  try {
    [fileLinkStoreSrv, chatService, videoOpenerSrv] = await Promise.all([
      fileStoreService(),

      w3n.rpc!.thisApp!('AppChatsInternal').then(
        srvConn =>
          makeServiceCaller<ChatSrvOverIPC>(
            srvConn,
            [
              // Answered from the component's own state rather than from the
              // service (see ipc-expose.ts), which is what makes it the one
              // call able to say whether the component is alive at all.
              'ping',
              'getAppDeviceId',
              'logFromGui',
              'createOneToOneChat',
              'createGroupChat',
              'acceptChatInvitation',
              'getChat',
              'getChatList',
              'renameChat',
              'chatSetUp',
              'deleteChat',
              'updateGroupMembers',
              'updateGroupAdmins',
              'deleteMessagesInChat',
              'deleteMessage',
              'deleteMessages',
              'deleteExpiredMessages',
              'collectGarbageInAuxiliaryDB',
              'releasePendingSyncPhantoms',
              'countPendingSyncPhantoms',
              'countSyncPhantomsInDelivery',
              'getSyncActivityState',
              'getBlacklistedAddresses',
              'removeExpiredInboxMessages',
              'getMessage',
              'getMessagesByChat',
              'getMessagesPageByChat',
              'getRecentReactions',
              'getThumbnails',
              'saveThumbnail',
              'sendRegularMessage',
              'markMessageAsReadNotifyingSender',
              'checkAddressExistenceForASMail',
              'cancelSendingMessage',
              'getIncomingMessage',
              'updateEarlySentMessage',
              'changeMessageReaction',
              'sendSystemDeletableMessage',
              'makeAndSaveMsgToDb',
              'saveAndSyncLocalSystemMsg',
              'createBackupPlan',
              'cancelBackupPlan',
              'previewRestore',
              'restoreBackupArchive',
              'handleIncomingMsg',
              'forceRefreshChat',
            ],
            ['watch'],
          ) as ChatSrvOverIPC,
      ),

      w3n.rpc!.thisApp!('VideoGUIOpener').then(
        srvConn =>
          makeServiceCaller<VideoGUIOpener>(
            srvConn,
            ['startVideoCallForChatRoom', 'joinOrDismissCallInRoom', 'endVideoCallInChatRoom', 'getCallsState'],
            ['watchVideoChats'],
          ) as VideoGUIOpener,
      ),
    ]);

    // Started here, but deliberately not awaited: the contacts app takes its
    // time to come up, and the point of keeping it out of the barrier above is
    // that this app must not wait for it. Kicking it off all the same, because
    // the cost has to be paid by somebody, and paying it in the background
    // beats paying it inside whatever first asks for a contact's name.
    contactsSrv().catch(err => log.error(`Contacts app is not reachable; names will show as addresses`, err));

    console.info('<- SERVICES ARE INITIALIZED ->');
  } catch (err) {
    log.error('# ERROR WHILE SERVICES INITIALISE # ', err);
    throw err;
  }
}
