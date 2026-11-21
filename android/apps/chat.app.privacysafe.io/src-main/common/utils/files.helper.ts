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
import type { Nullable } from '@v1nt1248/3nclient-lib';
import type { ReadonlyFile, ReadonlyFS } from '~/index';
import { chatService, fileLinkStoreSrv } from '@main/common/services/external-services';
import { makeLogger } from '@shared/logger';

const log = makeLogger('FilesHelper');

export async function getFileByInfoFromMsg(
  entityId: string,
  incomingMsgId?: string,
): Promise<Nullable<ReadonlyFile | ReadonlyFS>> {
  // A record synchronized from another device of the same user carries only the
  // attachments' metadata - the files themselves stay on the sending device, so
  // there is no id to look up. Guarding here covers every caller at once
  // (viewers, download, thumbnails) instead of each of them separately.
  if (!entityId) {
    return null;
  }

  if (incomingMsgId) {
    const msg = await chatService.getIncomingMessage(incomingMsgId);
    if (!msg) {
      return null;
    }

    const attachmentsList = await msg.attachments?.listFolder('');
    const currentAttachmentsItem = (attachmentsList || []).find(i => i.name === entityId);

    const entity = currentAttachmentsItem?.isFolder
      ? await msg.attachments?.readonlySubRoot(entityId)
      : await msg.attachments?.readonlyFile(entityId);

    return entity || null;
  }

  const entity = await fileLinkStoreSrv.getFile(entityId);
  return entity || null;
}

/**
 * The attachment as a readable file, or null when there is nothing to read.
 *
 * getFileByInfoFromMsg answers with a file or a folder, and every reader of
 * bytes had its own `as ReadonlyFile` cast over that - a cast that says nothing
 * when the entity turns out to be a folder. Here the folder case is an answer of
 * null, which callers already handle as "no file".
 */
export async function getReadableFileFromMsg(
  entityId: string | undefined,
  incomingMsgId?: string,
): Promise<Nullable<ReadonlyFile>> {
  if (!entityId) {
    return null;
  }

  const entity = await getFileByInfoFromMsg(entityId, incomingMsgId);
  if (!entity || (entity as ReadonlyFS).listFolder) {
    return null;
  }
  return entity as ReadonlyFile;
}

export async function saveFileFromMsg({ fileId, name, incomingMsgId, t }: {
  fileId: string;
  name?: string;
  t: (key: string, placeholders?: Record<string, string>) => string;
  incomingMsgId?: string;
}): Promise<boolean | undefined> {
  const entity = await getFileByInfoFromMsg(fileId, incomingMsgId);
  if (!entity) {
    return false;
  }

  if ((entity as ReadonlyFS).listFolder) {
    const targetFolder = await w3n.shell?.fileDialogs?.saveFolderDialog!(
      t('chat.message.dialog.folder_download.title'),
      // Not '': an empty label leaves the platform to put its own, untranslated
      // one on the button.
      t('app.text.save'),
      name || entity.name,
    );

    if (!targetFolder) {
      return undefined;
    }

    try {
      await targetFolder!.saveFolder(entity as ReadonlyFS, entity.name);
      return true;
    } catch (e) {
      log.error(`Error saving the folder ${entity.name}`, e);
      return false;
    }
  } else {
    const targetFile = await w3n.shell?.fileDialogs?.saveFileDialog!(
      t('chat.message.dialog.file_download.title'),
      t('app.text.save'),
      name || entity.name,
    );

    if (!targetFile) {
      return undefined;
    }

    try {
      const bytes = await (entity as ReadonlyFile).readBytes();
      await targetFile.writeBytes(bytes!);
      return true;
    } catch (e) {
      log.error(`Error saving the file ${entity.name}`, e);
      return false;
    }
  }
}
