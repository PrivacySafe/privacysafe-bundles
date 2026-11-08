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
import { inject } from 'vue';
import { useI18n } from 'vue-i18n';
import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import { contactsSrv } from '@main/common/services/external-services';
import { getFileByInfoFromMsg } from '@main/common/utils/files.helper';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ImportSharedContacts');

/** Extension of files with contacts shared by the contacts app. */
export const SHARED_CONTACTS_FILE_EXT = 'w3nec';

const CONTACTS_APP_DOMAIN = 'contacts.app.privacysafe.io';

export function isSharedContactsFile(ext: string | undefined): boolean {
  return (ext || '').toLowerCase() === SHARED_CONTACTS_FILE_EXT;
}

/**
 * Number of contacts in a file made by the contacts app, which puts it into
 * the name: `contacts-<date>-<time>-<count>.w3nec`. Undefined for a name of
 * another form, e.g. a renamed file.
 */
export function sharedContactsCountOf(fileName: string | undefined): number | undefined {
  const match = /^contacts-\d{4}-\d{2}-\d{2}-\d{4}-(\d+)\.w3nec$/i.exec(fileName || '');
  return match ? Number(match[1]) : undefined;
}

/**
 * Hands a file with shared contacts over to the contacts app, which reads it
 * and is then opened to import the contacts. The file goes over the inter-app
 * RPC: a start command carries only JSON.
 */
export function useImportSharedContacts() {
  const { t } = useI18n();
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY);

  async function importSharedContacts(entityId: string | undefined, incomingMsgId?: string): Promise<void> {
    try {
      const file = entityId ? await getFileByInfoFromMsg(entityId, incomingMsgId) : null;
      if (!file || (file as web3n.files.ReadonlyFS).listFolder) {
        notifications?.$createNotice({
          type: 'error',
          content: t('chat.message.action_message.error.file_notfound'),
          duration: 3000,
        });
        return;
      }

      const { importId } = await (await contactsSrv()).prepareSharedContactsImport(
        file as web3n.files.ReadonlyFile,
      );
      await w3n.shell!.startAppWithParams!(CONTACTS_APP_DOMAIN, 'import-contacts', { importId });
    } catch (err) {
      log.error('Error passing shared contacts to the contacts app', err);
      notifications?.$createNotice({
        type: 'error',
        content: t('chat.attachment.import_contacts.error'),
        duration: 5000,
      });
    }
  }

  return { importSharedContacts };
}
