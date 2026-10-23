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
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { defineStore } from 'pinia';
import { inboxSrv } from '@common/services/services-provider';
import { useAppStore } from '@common/store/app.store';
import { SYSTEM_FOLDERS } from '@common/constants';
import type { Nullable } from '@v1nt1248/3nclient-lib';
import type { AttachmentInfo, IncomingMessageView, MessageThread, OutgoingMessageView } from '@common/types';
import type { InboxUpdateEvent } from '@deno/types/inbox-srv.types';
import ConfirmationDialog from '@common/components/dialogs/confirmation-dialog/confirmation-dialog.vue';

function toCachedMessage(
  msg: IncomingMessageView | OutgoingMessageView,
): IncomingMessageView | OutgoingMessageView {
  return {
    ...msg,
    isIncomingMessage: 'sender' in msg,
  };
}

function getMessagesByThreads(
  messages: Record<string, IncomingMessageView | OutgoingMessageView>,
  excludeTrash?: boolean,
): Record<string, MessageThread> {
  return Object.values(messages).reduce(
    (res, msg) => {
      const { isIncomingMessage, threadId, mailFolder, deliveryTS = 0, cTime = 0 } = msg;

      const ts = deliveryTS || cTime;

      if (excludeTrash && mailFolder === SYSTEM_FOLDERS.trash) {
        return res;
      }

      if (!res[threadId]) {
        res[threadId] = {
          threadId,
          folders: [mailFolder],
          lastIncomingTS: isIncomingMessage ? ts : 0,
          lastOutgoingTS: !isIncomingMessage ? ts : 0,
          messages: [msg],
        };
      } else {
        const hasFolder = res[threadId].folders.includes(mailFolder);
        if (!hasFolder) {
          res[threadId].folders.push(mailFolder);
        }

        if (isIncomingMessage && res[threadId].lastIncomingTS < ts) {
          res[threadId].lastIncomingTS = ts;
        } else if (!isIncomingMessage && res[threadId].lastOutgoingTS < ts) {
          res[threadId].lastOutgoingTS = ts;
        }

        res[threadId].messages.push(msg);
      }

      return res;
    },
    {} as Record<string, MessageThread>,
  );
}

export const useMessagesStore = defineStore('messages', () => {
  const { t } = useI18n();

  const appStore = useAppStore();
  const { $dialogs } = appStore;

  const messageList = ref<Record<string, IncomingMessageView | OutgoingMessageView>>({});

  const messagesByThreads = computed(() => getMessagesByThreads(messageList.value, true));

  const messageThreadsByFolder = computed(() => {
    return Object.values(messagesByThreads.value).reduce(
      (res, thread) => {
        const { folders } = thread;
        for (const folder of folders) {
          if (!res[folder]) {
            res[folder] = [];
          }

          res[folder].push(thread);
        }

        return res;
      },
      {} as Record<string, MessageThread[]>,
    );
  });

  const messagesByFolders = computed(() => {
    return Object.values(messageList.value).reduce(
      (res, msg) => {
        const { mailFolder, msgId, status } = msg;

        if (!res[mailFolder]) {
          res[mailFolder] = { unread: 0, data: {} };
        }

        res[mailFolder].data[msgId!] = msg;
        if (status === 'received') {
          res[mailFolder].unread += 1;
        }

        return res;
      },
      {} as Record<string, { unread: number; data: Record<string, IncomingMessageView | OutgoingMessageView> }>,
    );
  });

  const messageThreadsFromTrash = computed(() =>
    getMessagesByThreads(messagesByFolders.value[SYSTEM_FOLDERS.trash]?.data || {}),
  );

  async function getMessages() {
    const messages = await inboxSrv.getMessages();

    messageList.value = (messages || []).reduce(
      (res, msg) => {
        res[msg.msgId!] = toCachedMessage(msg);
        return res;
      },
      {} as Record<string, IncomingMessageView | OutgoingMessageView>,
    );
  }

  function getMessage(msgId: string): Nullable<IncomingMessageView | OutgoingMessageView> {
    return messageList.value[msgId] || null;
  }

  function applyMessageEvent(event: Extract<InboxUpdateEvent, { entity: 'message' }>) {
    if (event.event === 'removed' && event.msgId) {
      delete messageList.value[event.msgId];
      return;
    }
    if (event.msg?.msgId) {
      messageList.value[event.msg.msgId] = toCachedMessage(event.msg);
    }
  }

  async function upsertMessage(messageData: IncomingMessageView | OutgoingMessageView) {
    await inboxSrv.upsertMessage(messageData);
  }

  async function moveToTrash(message: IncomingMessageView | OutgoingMessageView) {
    await inboxSrv.moveToTrash(message.msgId);
  }

  async function bulkMoveToTrash(messageIds: string[]) {
    await inboxSrv.bulkMoveToTrash(messageIds);
  }

  async function bulkRestore(messageIds: string[]) {
    await inboxSrv.bulkRestore(messageIds);
  }

  async function deleteMessages(messageIds: string[] = []) {
    await inboxSrv.deleteMessages(messageIds);
  }

  async function deleteMessagesUi(messageIds: string[] = []) {
    const res = await $dialogs.open<boolean>(ConfirmationDialog, {
      dialogText: t('msg.permanent_delete.string1'),
      additionalDialogText: t('msg.permanent_delete.string2'),
      dialogProps: {
        title: t('msg.permanent_delete.title'),
        width: 340,
        confirmButtonText: t('msg.permanent_delete.confirm_button'),
        confirmButtonBackground: 'var(--error-content-default)',
        confirmButtonColor: 'var(--error-fill-default)',
      },
    });

    const { event } = res;
    if (event === 'confirm') {
      try {
        await deleteMessages(messageIds);
        return true;
      } catch (error) {
        w3n.log('error', `Error while delete messages ${messageIds.join(', ')}`, error);
        return false;
      }
    }
  }

  async function getMessagesByThread(threadId: string) {
    return inboxSrv.getMessagesByThread(threadId);
  }

  async function downloadFileFromOutgoingMessage(attachment: AttachmentInfo) {
    if (!attachment?.id) {
      // Either the file was attached on another device of the user, or the
      // record is broken. Callers check the first case before opening a dialog;
      // this stays as the backstop.
      throw new Error(`This attachment has not id [${JSON.stringify(attachment)}]`);
    }

    // @ts-ignore
    const targetFile = await w3n.shell?.fileDialogs?.saveFileDialog(
      t('msg.download.file_title'),
      t('app.ok'),
      attachment.fileName,
    );

    if (targetFile) {
      await inboxSrv.copyFileTo(attachment.id, targetFile);
      return true;
    }
    return null;
  }

  /**
   * @returns how many of the asked-for files were left out - those attached on
   *          another device of the user - or null when the user closed the
   *          dialog. Reported rather than skipped silently: "Attachments have
   *          saved" over a folder some of the files never reached is a lie.
   */
  async function downloadFilesFromOutgoingMessage(
    msgId: string,
    ids: Array<string | undefined> = [],
  ): Promise<{ skipped: number } | null> {
    if (ids.length === 0) {
      throw new Error(`The message's ${msgId} attachments is empty`);
    }

    // @ts-ignore
    const targetFs = await w3n.shell?.fileDialogs?.saveFolderDialog(t('msg.download.title'), t('app.ok'), msgId);

    if (targetFs) {
      return await inboxSrv.copyFilesTo(ids, targetFs);
    }

    return null;
  }

  async function downloadFileFromIncomingMessage(msgId: string, fileName: string) {
    const sourceFile = await inboxSrv.getIncomingAttachment(msgId, fileName);
    if (!sourceFile) {
      throw new Error(`The message with ID '${msgId}' has not the file '${fileName}'.`);
    }

    // @ts-ignore
    const targetFile = await w3n.shell?.fileDialogs?.saveFileDialog(
      t('msg.download.file_title'),
      t('app.ok'),
      sourceFile.name,
    );

    if (targetFile) {
      await targetFile.copy(sourceFile);
      return true;
    }
    return null;
  }

  async function downloadAttachmentsFromIncomingMessage(msgId: string) {
    const sourceFolder = await inboxSrv.getIncomingAttachmentsFS(msgId);
    if (!sourceFolder) {
      throw new Error(`The message with ID '${msgId}' has not attachments'.`);
    }

    // @ts-ignore
    const targetFolder = await w3n.shell?.fileDialogs?.saveFolderDialog(
      t('msg.download.title'),
      t('app.ok'),
      msgId,
    );

    if (targetFolder) {
      await targetFolder.saveFolder(sourceFolder, 'attachments', true);
      return true;
    }

    return null;
  }

  return {
    messageList,
    messagesByThreads,
    messagesByFolders,
    messageThreadsByFolder,
    messageThreadsFromTrash,
    getMessages,
    getMessage,
    applyMessageEvent,
    upsertMessage,
    moveToTrash,
    bulkMoveToTrash,
    bulkRestore,
    deleteMessagesUi,
    deleteMessages,
    getMessagesByThread,
    downloadFileFromOutgoingMessage,
    downloadFilesFromOutgoingMessage,
    downloadFileFromIncomingMessage,
    downloadAttachmentsFromIncomingMessage,
  };
});
