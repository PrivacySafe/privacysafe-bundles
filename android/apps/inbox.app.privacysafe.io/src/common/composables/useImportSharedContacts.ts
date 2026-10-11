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
import { contactsSrv } from '@common/services/services-provider';
import { getFileByInfoFromMsg } from '@/common/utils/files';
import { makeLogger } from '@shared/utils/logger';
import type { AttachmentInfo } from '@common/types';

const log = makeLogger('ImportSharedContacts');

/** Extension of files with contacts shared by the contacts app. */
export const SHARED_CONTACTS_FILE_EXT = 'w3nec';

/**
 * Number of contacts in a file made by the contacts app, which puts it into
 * the name: `contacts-<date>-<time>-<count>.w3nec`. Undefined for a name of
 * another form, e.g. a renamed file.
 */
export function sharedContactsCountOf(fileName: string | undefined): number | undefined {
  const match = /^contacts-\d{4}-\d{2}-\d{2}-\d{4}-(\d+)\.w3nec$/i.exec(fileName || '');
  return match ? Number(match[1]) : undefined;
}

const CONTACTS_APP_DOMAIN = 'contacts.app.privacysafe.io';

/**
 * Hands a file with shared contacts over to the contacts app, which reads it
 * and is then opened to import the contacts. The file goes over the inter-app
 * RPC: a start command carries only JSON.
 */
export function useImportSharedContacts({ msgId, isIncomingMessage }: { msgId: string; isIncomingMessage: boolean }) {
  const { t } = useI18n();
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY);

  async function importSharedContacts(attachment: AttachmentInfo): Promise<void> {
    try {
      const file = await getFileByInfoFromMsg(attachment, isIncomingMessage ? msgId : undefined);
      if (!file) {
        notifications?.$createNotice({
          type: 'error',
          content: t('msg.attachment.import_contacts.not_found', { fileName: attachment.fileName }),
          duration: 5000,
        });
        return;
      }

      const { importId } = await (await contactsSrv()).prepareSharedContactsImport(file);
      await w3n.shell!.startAppWithParams!(CONTACTS_APP_DOMAIN, 'import-contacts', { importId });
    } catch (err) {
      log.error('Error passing shared contacts to the contacts app', err);
      notifications?.$createNotice({
        type: 'error',
        content: t('msg.attachment.import_contacts.error'),
        duration: 5000,
      });
    }
  }

  return { importSharedContacts };
}
