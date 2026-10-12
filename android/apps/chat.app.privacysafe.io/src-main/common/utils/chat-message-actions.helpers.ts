/*
Copyright (C) 2020 - 2025 3NSoft Inc.

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
import dayjs from 'dayjs';
import size from 'lodash/size';
import { useChatStore } from '@main/common/store/chat.store';
import { useMessagesStore } from '@main/common/store/messages.store';
import type { ReadonlyFile, ReadonlyFS, RegularMsgView } from '~/index';
import { makeLogger } from '@shared/logger';

const log = makeLogger('MsgActions');

export async function copyMessageToClipboard(message: RegularMsgView | undefined) {
  if (!message) {
    return;
  }

  const { body } = message;
  let copiedText = body;
  if ((message.chatMessageType === 'regular') && message.attachments) {
    copiedText += `${copiedText ? '\n' : ''}file('${message.attachments[0]['name']}')`;
  }

  await navigator.clipboard.writeText(copiedText);
}

export async function downloadAttachments(
  message: RegularMsgView | undefined,
  t: (key: string, placeholders?: Record<string, string>) => string,
): Promise<boolean | undefined> {
  if (!message || !message.attachments) {
    return;
  }

  const chatStore = useChatStore();
  const messagesStore = useMessagesStore();

  const { incomingMsgId, attachments, sender, timestamp } = message;
  const entities = await messagesStore.getMessageAttachments(attachments, incomingMsgId);

  try {
    // One file is saved as a file, with the save-file dialog. Besides being
    // what one expects, it keeps away from the save-folder dialog: no app
    // provides it, and the platform's own one fails as of core-platform-electron
    // 0.31.18 (`.bind(this)` in runner-in-electron/caps/shell/file-dialogs.ts).
    const names = entities ? Object.keys(entities) : [];
    if ((names.length === 1) && !(entities[names[0]] as ReadonlyFS).listFolder) {
      const [name] = names;
      const targetFile = await w3n.shell?.fileDialogs?.saveFileDialog!(
        t('chat.message.dialog.file_download.title'),
        t('app.text.save'),
        name,
      );

      if (!targetFile) {
        return undefined;
      }

      const bytes = await (entities[name] as ReadonlyFile).readBytes();
      await targetFile.writeBytes(bytes ?? new Uint8Array(0));
      return true;
    }

    if (entities && size(entities) > 0) {
      const targetFolderName = `${chatStore.currentChat?.name}_${sender}_${dayjs(timestamp).format('YYYY-MM-DD')}`;
      const targetFs = await w3n.shell?.fileDialogs?.saveFolderDialog!(
        t('chat.message.dialog.attachments_download.title'),
        t('app.ok'),
        targetFolderName,
      );

      if (!targetFs) {
        return undefined;
      }

      for (const entityName of Object.keys(entities)) {
        const isFolder = !!(entities[entityName] as ReadonlyFS).listFolder;

        if (isFolder) {
          await targetFs.saveFolder(entities[entityName] as ReadonlyFS, entityName);
        } else {
          await targetFs.saveFile(entities[entityName] as ReadonlyFile, entityName);
        }
      }

      return true;
    } else {
      return false;
    }
  } catch (err) {
    log.error(t('chat.message.action_message.error.file_download'), err);
    return false;
  }
}
