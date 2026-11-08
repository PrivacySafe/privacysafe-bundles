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
import { computed, inject, ref, type ComputedRef, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import dayjs from 'dayjs';
import size from 'lodash/size';
import isEmpty from 'lodash/isEmpty';
import { formatFileSize, getFileExtension } from '@v1nt1248/3nclient-lib/utils';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import { NOTIFICATIONS_KEY, type NotificationsPlugin } from '@v1nt1248/3nclient-lib/plugins';
import type { ChatMessageAttachmentsInfo, OutgoingAttachment } from '~/index';
import { chatService, fileLinkStoreSrv } from '@main/common/services/external-services';
import { useChatStore } from '@main/common/store/chat.store';
import { areChatIdsEqual } from '@shared/chat-ids';
import { MAX_ATTACHMENT_SIZE } from '@shared/constants/attachment-limits';
import { prepareAttachmentEntityInfo } from '@main/common/utils/chats.helper';
import { makeLogger } from '@shared/logger';

const log = makeLogger('ChatViewAttachments');

/**
 * What the attachments zone shares with the view around it: the readonly flag
 * that closes every way of attaching, the input element it returns focus to,
 * and the composer's text, which pasting a file must put back.
 */
export interface ChatViewAttachmentsDeps {
  readonly: ComputedRef<boolean>;
  inputEl: Ref<Nullable<HTMLTextAreaElement>>;
  msgText: Ref<string>;
}

/**
 * Everything that puts files into the composer: the file dialog, drag-and-drop
 * and paste, plus ownership of the storage items a pasted file leaves behind
 * before the message that takes them over is sent.
 */
export function useChatViewAttachments({ readonly, inputEl, msgText }: ChatViewAttachmentsDeps) {
  const { t } = useI18n();
  const notifications = inject<NotificationsPlugin>(NOTIFICATIONS_KEY);
  const { currentChatId } = storeToRefs(useChatStore());

  const files = ref<OutgoingAttachment[]>([]);
  /**
   * Storage items made for pasted files that are not part of a sent message
   * yet, and are therefore this composer's to remove. Emptied when a message
   * takes them over, so that a send followed by leaving the chat cannot delete
   * the attachments of the message just sent.
   */
  const ownedStoredIds = new Set<string>();

  const attachmentsInfo = ref<ChatMessageAttachmentsInfo[] | undefined>(undefined);

  const attachmentsTotal = computed(() => {
    if (isEmpty(attachmentsInfo.value)) {
      return 0;
    }

    return (attachmentsInfo.value || []).reduce((acc, item) => {
      acc += item.size;
      return acc;
    }, 0);
  });

  /**
   * Adds one picked entity to the composer, or says why it cannot be added.
   *
   * Shared by every way of attaching - the dialog, drag-and-drop and paste -
   * so that the size limit and the error reporting hold for all of them, and
   * so that one unattachable file does not lose the others picked with it.
   */
  async function attachEntity(attachment: OutgoingAttachment): Promise<boolean> {
    const { entity, name } = attachment;
    const fileName = name ?? entity.name;
    try {
      // Folders are not size-checked here: their size is only known after a
      // full walk of the tree, which is not a price to pay on every drop. The
      // tile computes it for display, and sending decides on a walk bounded by
      // the copying threshold.
      const isFolder = !!(entity as web3n.files.ReadonlyFS).listFolder;
      if (!isFolder) {
        const { size = 0 } = await (entity as web3n.files.ReadonlyFile).stat();
        if (size > MAX_ATTACHMENT_SIZE) {
          notifications?.$createNotice({
            type: 'error',
            content: t('chat.attachment.too_big.error', {
              fileName,
              limit: formatFileSize(MAX_ATTACHMENT_SIZE),
            }),
          });
          return false;
        }
      }

      const attachmentInfo = await prepareAttachmentEntityInfo(entity, name);
      if (!attachmentInfo) {
        return false;
      }

      files.value.push(attachment);
      attachmentsInfo.value!.push(attachmentInfo);
      return true;
    } catch (e) {
      log.error(`Error attaching the file '${fileName}'.`, e);

      notifications?.$createNotice({
        type: 'error',
        content: t('chat.attachment.attaching.error', { fileName }),
      });
      return false;
    }
  }

  async function addFiles(): Promise<void> {
    // The button that calls this is disabled in a readonly chat, but a guard
    // here as well - the other two ways of attaching (drag-and-drop and paste)
    // have had one from the start, and a disabled button is a statement about
    // the markup, not about what may be attached.
    if (readonly.value) {
      return;
    }

    if (isEmpty(attachmentsInfo.value)) {
      attachmentsInfo.value = [];
    }

    const newFiles = await w3n.shell?.fileDialogs?.openFileDialog!(
      t('chat.attachment.dialog.title'),
      t('chat.attachment.dialog.btn.select'),
      true,
    );
    if (!newFiles) {
      return;
    }

    for (const f of newFiles) {
      await attachEntity({ entity: f });
    }

    inputEl.value && inputEl.value.focus();
  }

  /**
   * Name for a screenshot pasted from the clipboard, which arrives as plain
   * `image.png` and would otherwise reach the recipient under that name - or,
   * before the stored item's own name stopped being used, as `image-x7q.png`.
   *
   * Dashes in the time rather than colons: a colon cannot be part of a file
   * name on Windows, and the recipient saving the attachment there would hit
   * exactly that.
   */
  function nameOfPastedFile(f: File): string {
    if (!f.type.startsWith('image/')) {
      return f.name;
    }

    // The pasted name is where the extension comes from first: a clipboard
    // image arrives as `image.png`, and its media type can be something like
    // `image/svg+xml`, whose subtype is no extension at all.
    const ext = getFileExtension(f.name) || f.type.slice('image/'.length).replace(/[^a-z0-9]/gi, '');
    return `screenshot_${dayjs().format('YY-MM-DD_HH-mm-ss')}${ext ? `.${ext}` : ''}`;
  }

  /**
   * A clipboard file has no existence outside this app, so it has to be written
   * into the app's storage before it can be attached at all. The id of what was
   * written travels with it: sending then takes that item over as the message's
   * attachment instead of storing the same bytes a second time.
   */
  async function fileTo3nFile(f: File): Promise<OutgoingAttachment | undefined> {
    const name = nameOfPastedFile(f);
    // Checked before the bytes are written, not after: there is no point in
    // filling the storage with a file that is about to be refused.
    if (f.size > MAX_ATTACHMENT_SIZE) {
      notifications?.$createNotice({
        type: 'error',
        content: t('chat.attachment.too_big.error', {
          fileName: name,
          limit: formatFileSize(MAX_ATTACHMENT_SIZE),
        }),
      });
      return;
    }

    const fileContent = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const content = e.target?.result;
        content ? resolve(content as ArrayBuffer) : reject(new Error(`No content read from ${f.name}`));
      };
      reader.onerror = e => reject(e);
      reader.readAsArrayBuffer(f);
    });

    const storedId = await fileLinkStoreSrv.saveFile(fileContent, name);
    ownedStoredIds.add(storedId);
    const entity = (await fileLinkStoreSrv.getFile(storedId)) as web3n.files.ReadonlyFile | null | undefined;
    if (!entity) {
      await discardOwnedStoredItems([storedId]);
      return;
    }
    return { entity, storedId, name };
  }

  async function addFilesViaDnD(fileList: FileList): Promise<void> {
    if (readonly.value) {
      return;
    }

    if (isEmpty(attachmentsInfo.value)) {
      attachmentsInfo.value = [];
    }
    // @ts-ignore
    for (const f of [...fileList]) {
      let attachment: OutgoingAttachment | undefined;

      try {
        const fStats = await w3n.shell!.deviceFiles?.statStandardItem(f);

        const entity = fStats!.isFolder
          ? await w3n.shell!.deviceFiles?.standardFileToDeviceFolder!(f)
          : await w3n.shell!.deviceFiles?.standardFileToDeviceFile!(f);
        attachment = entity ? { entity } : undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        if (e.type === 'file' && e.isInMemoryFile) {
          try {
            attachment = await fileTo3nFile(f);
          } catch (err) {
            log.error(`Error storing the pasted file '${f.name}'.`, err);
            notifications?.$createNotice({
              type: 'error',
              content: t('chat.attachment.attaching.error', { fileName: f.name }),
            });
          }
        } else {
          log.error('Error reading file. ', e);
        }
      }

      if (attachment) {
        const added = await attachEntity(attachment);
        if (!added && attachment.storedId) {
          await discardOwnedStoredItems([attachment.storedId]);
        }
      }
    }

    inputEl.value && inputEl.value.focus();
  }

  async function addFilesViaPaste(ev: ClipboardEvent): Promise<void> {
    if (size(ev.clipboardData?.files) > 0) {
      const currentMsgText = msgText.value;
      await addFilesViaDnD(ev.clipboardData!.files);
      inputEl.value && inputEl.value.select();
      const selection = window.getSelection();
      if (selection) {
        selection.deleteFromDocument();
        msgText.value = currentMsgText;
      }
    }
  }

  /**
   * Removes the storage items this composer still owns.
   *
   * Only a pasted file leaves an item behind before the message is sent, and
   * until it is sent nothing else in the app knows of it - so dropping such an
   * attachment, or walking away from the composer, has to take the item with
   * it. Once the message is on its way the item belongs to the message, and
   * deleting it is the business of deleting that message.
   */
  async function discardOwnedStoredItems(ids: string[]): Promise<void> {
    for (const id of ids) {
      if (!ownedStoredIds.has(id)) {
        continue;
      }
      ownedStoredIds.delete(id);
      try {
        await fileLinkStoreSrv.deleteEntity(id);
      } catch (e) {
        log.error(`Error removing the stored item ${id} of an unsent attachment.`, e);
      }
    }
  }

  async function deleteAttachment(index: number) {
    const removed = files.value ? files.value.splice(index, 1) : [];
    attachmentsInfo.value && attachmentsInfo.value.splice(index, 1);
    if (size(attachmentsInfo.value) === 0) {
      attachmentsInfo.value = undefined;
    }

    await discardOwnedStoredItems(removed.map(a => a.storedId!).filter(Boolean));
  }

  async function clearAttachments() {
    const removed = files.value.map(a => a.storedId!).filter(Boolean);
    files.value = [];
    attachmentsInfo.value = undefined;

    await discardOwnedStoredItems(removed);
  }

  /**
   * Puts into the composer the attachments of a draft that another app (e.g.
   * Contacts sharing contacts) prepared in the background, see AppChats in
   * manifest.json. The stored files become this composer's own: leaving the
   * chat without sending removes them, just as with pasted files.
   */
  async function takeExternalDraft(draftId: string): Promise<void> {
    const draft = await chatService.takeExternalDraft(draftId);
    if (!draft) {
      log.error(`External draft ${draftId} is not found, or is already taken`);
      return;
    }

    for (const { storedId } of draft.attachments) {
      ownedStoredIds.add(storedId);
    }

    if (readonly.value || !currentChatId.value || !areChatIdsEqual(draft.chatId, currentChatId.value)) {
      log.error(`External draft ${draftId} is not for the opened chat, or the chat is readonly`);
      await discardOwnedStoredItems(draft.attachments.map(({ storedId }) => storedId));
      return;
    }

    if (isEmpty(attachmentsInfo.value)) {
      attachmentsInfo.value = [];
    }

    for (const { storedId, name } of draft.attachments) {
      const entity = (await fileLinkStoreSrv.getFile(storedId)) as web3n.files.ReadonlyFile | null | undefined;
      const attached = entity ? await attachEntity({ entity, storedId, name }) : false;
      if (!attached) {
        await discardOwnedStoredItems([storedId]);
      }
    }

    inputEl.value && inputEl.value.focus();
  }

  return {
    files,
    ownedStoredIds,
    attachmentsInfo,
    attachmentsTotal,
    attachEntity,
    addFiles,
    addFilesViaDnD,
    addFilesViaPaste,
    fileTo3nFile,
    discardOwnedStoredItems,
    deleteAttachment,
    clearAttachments,
    takeExternalDraft,
  };
}

export type ChatViewAttachments = ReturnType<typeof useChatViewAttachments>;
