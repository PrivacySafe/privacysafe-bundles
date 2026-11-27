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
import { computed, inject } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DIALOGS_KEY,
  type DialogsPlugin,
  NOTIFICATIONS_KEY,
  NotificationsPlugin,
} from '@v1nt1248/3nclient-lib/plugins';
import { isRiskyFileName } from '@main/common/utils/risky-file';
import { escapeHtml } from '@main/common/utils/escape-html';
import ConfirmationDialog from '@main/common/components/dialogs/confirmation-dialog.vue';
import type { AttachmentViewInfo } from './types';
import { fileLinkStoreSrv } from '@main/common/services/external-services';
import { useOpenReceivedAttachment } from './useOpenReceivedAttachment';
import { makeLogger } from '@shared/logger';
const log = makeLogger('UseOpenAttachment');

export function useOpenAttachment(
  props: { item?: AttachmentViewInfo; incomingMsgId?: string; blocked?: boolean },
  emits?: { (event: 'close'): void },
) {
  const { t } = useI18n();
  const { $createNotice } = inject<NotificationsPlugin>(NOTIFICATIONS_KEY)!;
  const dialog = inject<DialogsPlugin>(DIALOGS_KEY)!;
  const receivedOpening = useOpenReceivedAttachment({ t });

  const isReceivedOpenAvailable = computed(
    () => !!props.incomingMsgId && !props.blocked && receivedOpening.isOpenAvailable(),
  );
  const isPreparingToOpen = computed(
    () =>
      !!props.incomingMsgId &&
      !!props.item &&
      receivedOpening.isPreparingAttachment(props.incomingMsgId, [props.item.id || props.item.name]),
  );
  const isPreparingFolder = computed(
    () => !!props.incomingMsgId && receivedOpening.isPreparingAttachment(props.incomingMsgId, []),
  );

  function showError(error?: unknown) {
    const exc = error as web3n.files.FileException | null | undefined;
    const errorKey =
      exc?.type === 'file' && exc.notFound
        ? 'chat.message.action_message.error.file_notfound'
        : 'chat.message.attachment.opening.error';
    $createNotice({
      type: 'error',
      content: t(errorKey, { fileName: props.item?.name || '' }),
      duration: 3000,
    });
    if (emits) {
      emits('close');
    }
  }

  function isPreparingPath(path: string[]): boolean {
    return !!props.incomingMsgId && receivedOpening.isPreparingAttachment(props.incomingMsgId, path);
  }

  /**
   * A received file that the OS would run is opened only after the user says
   * so: the sender chose its name, and opening goes to the OS default handler.
   */
  async function confirmRiskyOpening(name: string | undefined): Promise<boolean> {
    if (!isRiskyFileName(name)) {
      return true;
    }
    const res = await dialog.$openDialog<boolean>(ConfirmationDialog, {
      dialogText: t('chat.message.dialog.risky_attachment.text', { name: `<b>${escapeHtml(name)}</b>` }),
      dialogProps: {
        title: t('chat.message.dialog.risky_attachment.title'),
        icon: { icon: 'round-warning', color: 'var(--color-icon-control-warning-default)' },
      },
    });
    return res.event === 'confirm';
  }

  async function openReceivedPath(path: string[], displayedName?: string): Promise<void> {
    if (!props.incomingMsgId || props.blocked) {
      return;
    }
    if ((path.length > 0) && !(await confirmRiskyOpening(displayedName ?? path[path.length - 1]))) {
      return;
    }
    await receivedOpening.openAttachment(props.incomingMsgId, path);
  }

  async function openAttachmentsFolder(): Promise<void> {
    await openReceivedPath([]);
  }

  async function openEntity() {
    if (!props.item || props.blocked) {
      return;
    }
    if (props.incomingMsgId) {
      await openReceivedPath([props.item.id || props.item.name], props.item.isFolder ? undefined : props.item.name);
      return;
    }

    const shell = w3n.shell;
    if (typeof (props.item.isFolder ? shell?.openFolder : shell?.openFile) !== 'function') {
      $createNotice({ type: 'error', content: t('chat.message.attachment.opening.unavailable') });
      return;
    }

    // Sent attachments keep their existing direct-opening behavior in this pass.
    try {
      if (!props.item.id) {
        showError();
        return;
      }
      const entity = await fileLinkStoreSrv.getFile(props.item.id, { throwOnError: true });
      if (!entity) {
        showError();
        return;
      }

      if (props.item.isFolder) {
        await shell!.openFolder!(entity as web3n.files.ReadonlyFS);
      } else {
        await shell!.openFile!(entity as web3n.files.ReadonlyFile);
      }
    } catch (error) {
      log.error(`Error opening sent attachment '${props.item.name}'`, error);
      showError(error);
    }
  }

  return {
    t,
    $createNotice,
    showError,
    openEntity,
    openReceivedPath,
    openAttachmentsFolder,
    isReceivedOpenAvailable,
    isPreparingToOpen,
    isPreparingFolder,
    isPreparingPath,
  };
}
