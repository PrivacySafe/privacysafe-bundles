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
import { inject } from 'vue';
import { NOTIFICATIONS_KEY, NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import { useMessagesStore } from '@common/store';
import { attachmentAvailabilityOf } from '@shared/utils/attachment-availability';
import type { AttachmentInfo } from '@common/types';

export function useDownloadAttachments({
  msgId,
  isIncomingMessage,
  t,
}: {
  msgId: string;
  isIncomingMessage: boolean;
  t: (txt: string, placeholder?: Record<string, string>) => string;
}) {
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const {
    downloadFileFromOutgoingMessage,
    downloadFilesFromOutgoingMessage,
    downloadFileFromIncomingMessage,
    downloadAttachmentsFromIncomingMessage,
  } = useMessagesStore();

  async function downloadAll(attachments: AttachmentInfo[] = []) {
    try {
      if (isIncomingMessage) {
        // The bytes of an incoming message's attachments are in the shared
        // inbox, so every device can read all of them.
        const isSuccess = await downloadAttachmentsFromIncomingMessage(msgId);
        if (isSuccess) {
          $createNotice({ type: 'success', content: t('msg.attachments.writing.success') });
        }
        return;
      }

      const available = attachments.filter(item => !item.hasNoLocalSource);
      if (available.length === 0) {
        // Checked BEFORE the save dialog is opened: a dialog followed by an
        // error is the most irritating of the possible behaviours.
        $createNotice({ type: 'error', content: t('msg.attachments.on_another_device') });
        return;
      }

      // Every record is passed on, unavailable ones included: the count of what
      // was left out comes back from the one place that decides it.
      const result = await downloadFilesFromOutgoingMessage(
        msgId,
        attachments.map(item => item.id),
      );
      if (!result) {
        return;
      }

      $createNotice(
        result.skipped > 0
          ? {
            type: 'info',
            content: t('msg.attachments.partially_downloaded', {
              done: `${attachments.length - result.skipped}`,
              total: `${attachments.length}`,
            }),
          }
          : { type: 'success', content: t('msg.attachments.writing.success') },
      );
    } catch (error) {
      w3n.log('error', `Error downloading attachments of the message with id ${msgId}`, error);

      $createNotice({
        type: 'error',
        content: t('msg.attachments.writing.error'),
      });
    }
  }

  async function downloadAttachment(attachment: AttachmentInfo) {
    // Before the save dialog, for the same reason as above.
    if (attachmentAvailabilityOf(attachment, isIncomingMessage ? msgId : undefined)
      === 'on-another-device') {
      $createNotice({
        type: 'error',
        content: t('msg.attachment.on_another_device', { fileName: attachment.fileName }),
      });
      return;
    }

    try {
      const isSuccess = isIncomingMessage
        ? await downloadFileFromIncomingMessage(msgId, attachment.fileName)
        : await downloadFileFromOutgoingMessage(attachment);

      if (isSuccess) {
        $createNotice({
          type: 'success',
          content: t('msg.attachment.writing.success', { fileName: attachment.fileName }),
        });
      }
    } catch (error) {
      w3n.log(
        'error',
        `Error downloading the file '${attachment.fileName}' from the message with id ${msgId}`,
        error,
      );

      $createNotice({
        type: 'error',
        content: t('msg.attachment.writing.error', { fileName: attachment.fileName }),
      });
    }
  }

  return {
    downloadAll,
    downloadAttachment,
  };
}
