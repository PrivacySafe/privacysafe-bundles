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
import { useI18n } from 'vue-i18n';
import { NOTIFICATIONS_KEY, NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import type { AttachmentViewInfo } from './types';
import { getFileByInfoFromMsg } from '@main/common/utils/files.helper.ts';

export function useOpenAttachment(
  props: { item: AttachmentViewInfo; incomingMsgId?: string },
  emits?: { (event: 'close'): void },
) {
  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;

  function showError() {
    $createNotice({
      type: 'error',
      content: t('chat.message.action_message.error.file_notfound'),
      duration: 3000,
    });

    emits && emits('close');
  }

  async function openEntity() {
    try {
      const entity = await getFileByInfoFromMsg(props.item.id!, props.incomingMsgId);
      if (!entity) {
        showError();
        return;
      }

      if (props.item.isFolder) {
        await w3n.shell?.openFolder!(entity as web3n.files.ReadonlyFS);
      } else {
        await w3n.shell?.openFile!(entity as web3n.files.ReadonlyFile);
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      showError();
    }
  }

  return {
    t,
    $createNotice,
    showError,
    openEntity,
  };
}
