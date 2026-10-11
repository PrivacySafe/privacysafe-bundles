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
import { sleep } from '../shared-libs/processes/sleep.ts';
import { zipEntries, type ZipEntryInput } from './contacts-backup-srv.ts';
import { callChatApp, callInboxApp } from './external-apps.ts';
import { imageFromDataURL } from './utils/image-data-url.ts';
import type { ContactDB } from './dataset/contacts-db.ts';
import {
  SHARE_DATA_FILE,
  SHARE_DATA_VERSION,
  SHARE_FILE_EXT,
  SHARE_IMAGES_FOLDER,
  SHARE_TMP_FOLDER,
} from './constants.ts';
import type {
  ContactEvent,
  Person,
  ShareChannel,
  SharedContactsData,
  SharedPerson,
  ShareProgress,
} from '../src/types/index.ts';

const YIELD_EVERY = 10;
const YIELD_MS = 5;

/**
 * Percent of the progress bar given to the making of the file; the rest is
 * for handing it over to the other app, which copies it into its own store.
 */
const PREPARING_SHARE = 90;

function checkAbortSignal(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Sharing cancelled', 'AbortError');
  }
}

/**
 * Only what describes the contact goes out. Things that are this user's own
 * business stay here: blocking settings and the history of activities.
 */
function toSharedPerson(contact: Omit<Person, 'avatarImage'>, hasAvatar: boolean): SharedPerson {
  const { name, mail, avatarId, notice, phone, timestamp } = contact;
  return {
    name,
    mail,
    ...(hasAvatar && avatarId ? { avatarId } : {}),
    notice,
    phone,
    timestamp,
    settings: null,
    activities: null,
    key: null,
  };
}

/**
 * Name of an export file, `contacts-<date>-<time>-<count>.w3nec`. The number of
 * contacts is in the name for the chat and inbox apps, which show it with the
 * attachment without reading the file (see their sharedContactsCountOf).
 */
function exportFileName(contactsCount: number): string {
  const now = new Date();
  const pad = (n: number) => `${n}`.padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `contacts-${date}-${time}-${contactsCount}.${SHARE_FILE_EXT}`;
}

export async function contactsShareSrv({
  contactDbSrv,
  imagesFolder,
  emitStorageEvent,
}: {
  contactDbSrv: ContactDB;
  imagesFolder: web3n.files.WritableFS;
  emitStorageEvent: (event: ContactEvent) => void;
}) {
  const localFs = await w3n.storage!.getAppLocalFS!();

  // Files of a share are removed as soon as the other app has copied them;
  // what is still here was left by a run that ended halfway.
  if (await localFs.checkFolderPresence(SHARE_TMP_FOLDER)) {
    await localFs.deleteFolder(SHARE_TMP_FOLDER, true).catch(err =>
      w3n.log('warning', `Fail to remove leftovers of sharing contacts`, err),
    );
  }

  let activeAbortController: AbortController | null = null;
  let isSharing = false;

  function emitShareProgress(payload: ShareProgress): void {
    emitStorageEvent({ event: 'share', payload });
  }

  /**
   * Makes the archive: a data file with an array of SharedPerson, and the
   * folder with avatars of these contacts.
   */
  async function buildShareArchive(
    contactIds: string[],
    channel: ShareChannel,
    signal: AbortSignal,
  ): Promise<{ archive: Uint8Array; contactsCount: number }> {
    const totalContacts = contactIds.length;
    const contacts: SharedPerson[] = [];
    const entries: ZipEntryInput[] = [];

    for (let i = 0; i < totalContacts; i++) {
      checkAbortSignal(signal);

      const contact = contactDbSrv.getContactFrom(contactIds[i]);
      if (contact) {
        let hasAvatar = false;
        const { avatarId } = contact;
        if (avatarId) {
          try {
            const image = imageFromDataURL(await imagesFolder.readTxtFile(avatarId));
            if (image) {
              entries.push({ path: `${SHARE_IMAGES_FOLDER}/${avatarId}.${image.ext}`, bytes: image.bytes });
              hasAvatar = true;
            }
          } catch (err) {
            // A contact without its picture is still worth sharing.
            await w3n.log('warning', `Avatar ${avatarId} is left out of the shared contacts`, err);
          }
        }
        contacts.push(toSharedPerson(contact, hasAvatar));
      }

      emitShareProgress({
        stage: 'preparing',
        channel,
        totalContacts,
        processedContacts: i + 1,
        percent: Math.round(((i + 1) / totalContacts) * (PREPARING_SHARE - 5)),
      });

      if ((i > 0) && (i % YIELD_EVERY === 0)) {
        await sleep(YIELD_MS);
      }
    }

    if (contacts.length === 0) {
      throw new Error('None of the contacts to share is found');
    }

    const data: SharedContactsData = {
      version: SHARE_DATA_VERSION,
      createdAt: Date.now(),
      contacts,
    };
    entries.unshift({ path: SHARE_DATA_FILE, bytes: new TextEncoder().encode(JSON.stringify(data)) });

    const archive = await zipEntries(entries, signal);
    emitShareProgress({
      stage: 'preparing',
      channel,
      totalContacts,
      processedContacts: totalContacts,
      percent: PREPARING_SHARE,
    });
    return { archive, contactsCount: contacts.length };
  }

  /**
   * Whether the chat app has an active one-to-one chat with the address, i.e.
   * the other side has agreed to talk in the chat. Any failure, including no
   * chat app at all, answers false.
   */
  async function checkChatWithPeer(addr: string): Promise<boolean> {
    if (!addr || (typeof addr !== 'string')) {
      return false;
    }

    try {
      const status = await callChatApp(srv => srv.getOneToOneChatStatus(addr));
      return status === 'on';
    } catch (err) {
      await w3n.log('warning', `Fail to check a chat with ${addr} in the chat app`, err);
      return false;
    }
  }

  /**
   * Makes the export file with given contacts, and hands it over to the chat
   * or inbox app as an attachment of a message draft to the recipient.
   * Returned draft id is to be passed to the app in its start command.
   */
  async function shareContacts({
    contactIds,
    recipient,
    channel,
  }: {
    contactIds: string[];
    recipient: string;
    channel: ShareChannel;
  }): Promise<{ draftId: string }> {
    if (isSharing) {
      throw new Error('Another sharing of contacts is in progress');
    }
    if (!Array.isArray(contactIds) || (contactIds.length === 0)) {
      throw new Error('No contacts to share');
    }
    if (!recipient || (typeof recipient !== 'string')) {
      throw new Error('Invalid recipient of shared contacts');
    }
    if ((channel !== 'chat') && (channel !== 'mail')) {
      throw new Error(`Unknown channel ${channel} of sharing contacts`);
    }

    isSharing = true;
    const abortController = new AbortController();
    activeAbortController = abortController;
    const { signal } = abortController;
    const totalContacts = contactIds.length;
    let tmpFolder: web3n.files.WritableFS | undefined = undefined;
    let fileName = '';

    try {
      emitShareProgress({ stage: 'preparing', channel, totalContacts, processedContacts: 0, percent: 0 });
      const { archive, contactsCount } = await buildShareArchive(contactIds, channel, signal);
      fileName = exportFileName(contactsCount);

      checkAbortSignal(signal);
      tmpFolder = await localFs.writableSubRoot(SHARE_TMP_FOLDER);
      await tmpFolder.writeBytes(fileName, archive);
      const file = await tmpFolder.readonlyFile(fileName);

      // From here on there is nothing to cancel: the other app is copying the
      // file, and a draft it makes is cleaned up by that app itself.
      checkAbortSignal(signal);
      activeAbortController = null;
      emitShareProgress({ stage: 'sending', channel, totalContacts, processedContacts: totalContacts, percent: 95 });

      const files = [{ file, name: fileName }];
      const { draftId } = (channel === 'chat')
        ? await callChatApp(srv => srv.prepareOutgoingDraft({ peerAddress: recipient, files }))
        : await callInboxApp(srv => srv.prepareDraft({ recipients: [recipient], files }));

      emitShareProgress({ stage: 'completed', channel, totalContacts, processedContacts: totalContacts, percent: 100 });
      return { draftId };
    } catch (err) {
      const isCancelled = signal.aborted || ((err as Error)?.name === 'AbortError');
      emitShareProgress({
        stage: isCancelled ? 'cancelled' : 'error',
        channel,
        totalContacts,
        processedContacts: 0,
        percent: 0,
      });
      if (!isCancelled) {
        await w3n.log('error', `Fail to share contacts via ${channel}`, err);
      }
      throw err;
    } finally {
      isSharing = false;
      if (activeAbortController === abortController) {
        activeAbortController = null;
      }
      // The other app has its own copy by now, or there is nothing to send.
      if (tmpFolder && fileName) {
        await tmpFolder.deleteFile(fileName).catch(err =>
          w3n.log('warning', `Fail to remove a file ${fileName} of shared contacts`, err),
        );
      }
    }
  }

  async function cancelShareContacts(): Promise<boolean> {
    if (activeAbortController && !activeAbortController.signal.aborted) {
      activeAbortController.abort();
      activeAbortController = null;
      return true;
    }
    return false;
  }

  return {
    checkChatWithPeer,
    shareContacts,
    cancelShareContacts,
  };
}
