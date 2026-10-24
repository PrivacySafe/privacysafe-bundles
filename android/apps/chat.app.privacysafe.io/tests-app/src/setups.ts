import { ChatSrv } from './../../src-deno/types/chat-srv.types';
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

/* eslint-disable @typescript-eslint/no-explicit-any */

import { chatService } from '@main/common/services/external-services.ts';
import { AppViewInstance, useAppView } from '@main/common/composables/useAppView.ts';
import { UpdateEvent } from '~/services.types';
import { ChatStore, useChatStore } from '@main/common/store/chat.store.ts';
import { addMsgToPage } from './test-page-utils';
import { sleep } from './lib-common/processes/sleep';
import { ChatInvitationMsgView, RegularMsgView } from '~/chat.types';
import { ChatsStore, useChatsStore } from '@main/common/store/chats.store.ts';
import { useMessagesStore } from '@main/common/store/messages.store.ts';

declare const w3n: web3n.testing.CommonW3N;

export interface TestSetupContainer extends Window {
  testSetup: {
    fstUserAddr: string;
    fstUserName: string;
    sndUserAddr: string;
    sndUserName: string;
    thirdUserAddr: string;
    thirdUserName: string;
    appView: AppViewInstance;
    chatService: ChatSrv;
  };
}

export async function setupBeforeAllTests(): Promise<void> {

  const appView = useAppView();

  const fstUserAddr = await w3n.testStand.idOfTestUser(1);
  const fstUserName = `1st user`;
  const sndUserAddr = await w3n.testStand.idOfTestUser(2);
  const sndUserName = `2nd user`;
  const thirdUserAddr = await w3n.testStand.idOfTestUser(3);
  const thirdUserName = `3rd user`;

  (window as any as TestSetupContainer).testSetup = {
    appView,
    chatService,
    fstUserAddr, fstUserName, sndUserAddr, sndUserName,
    thirdUserAddr, thirdUserName,
  };
}

export function setupSecondaryUser(userNum: 2 | 3): void {
  const { sndUserName, thirdUserName } = (window as any as TestSetupContainer).testSetup;
  let userName: string;
  if (userNum === 2) {
    userName = sndUserName;
  } else if (userNum === 3) {
    userName = thirdUserName;
  } else {
    throw new Error(`Invalid user number ${userNum}`);
  }
  const chatStore = useChatStore();
  const chatsStore = useChatsStore();
  const messagesStore = useMessagesStore();
  const markIncomingMessagesRead = handlerToMarkIncomingMessagesRead(messagesStore);
  const sendAttachmentBackInReply = handlerToSendAttachmentBackInReply(chatStore, messagesStore);
  const acceptChatInvite = handlerToAcceptChatInvitation(
    chatsStore, userName,
  );
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const stopWatching = chatService.watch({
    next: ev => {
      if ((ev.updatedEntityType === 'message') && (ev.event === 'added')) {
        const { msg } = ev;
        const { isIncomingMsg, chatMessageType } = msg;
        if (isIncomingMsg) {
          if (chatMessageType === 'regular') {
            markIncomingMessagesRead(msg);
            sendAttachmentBackInReply(msg);
          } else if (chatMessageType === 'invitation') {
            acceptChatInvite(msg);
          }
        }
      }
      displayUpdateEvent(ev);
    },
    error: err => w3n.log('error', 'Failure in watching chat service events. ', err),
    complete: () => console.warn(`Watching chat service events completed`),
  });
}

function handlerToAcceptChatInvitation(
  chatsStore: ChatsStore, sndUserName: string,
): (msg: ChatInvitationMsgView) => void {
  const { acceptChatInvitation } = chatsStore;
  return async msg => {
    const { type } = msg.inviteData;
    if ((type === 'oto-chat-invite') || (type === 'group-chat-invite')) {
      const { chatId, chatMessageId } = msg;
      await sleep(1000);
      await acceptChatInvitation({ chatId, chatMessageId }, sndUserName)
        .catch(err => w3n.log('error', 'Error in accepting chat invitation', err,));
    }
  };
}

function handlerToMarkIncomingMessagesRead(
  messagesStore: ReturnType<typeof useMessagesStore>,
): (msg: RegularMsgView) => void {
  const { markMessageAsRead } = messagesStore;
  return async msg => {
    const {
      isIncomingMsg, status, chatId, chatMessageId,
    } = msg;
    if (isIncomingMsg && (status === 'unread')) {
      await sleep(1000);
      await markMessageAsRead(chatId, chatMessageId)
        .catch(err => console.error(
          `Error in marking incoming message as read`, err,
        ));
    }
  };
}

function handlerToSendAttachmentBackInReply(
  chatStore: ChatStore,
  messagesStore: ReturnType<typeof useMessagesStore>,
): (msg: RegularMsgView) => void {
  const { setChatAndFetchMessages, sendMessageInChat } = chatStore;
  const { getMessageAttachments } = messagesStore;
  const fsPromise = w3n.storage!.getAppLocalFS().then(
    fs => fs.writableSubRoot(`test on ${Date.now()}`),
  );
  return async msg => {
    // TODO
  }
  // return async msg => {
  //   const { isIncomingMsg, attachments, incomingMsgId } = msg;
  //   if (!isIncomingMsg || !attachments || !incomingMsgId) {
  //     return;
  //   }
  //   // get attachment
  //   const { chatId, chatMessageId, body } = msg;
  //   await setChatAndFetchMessages(chatId);
  //   const filesFromInbox = Array.from(Object.values(await getMessageAttachments(
  //     attachments, incomingMsgId,
  //   )));
  //   // put them into linkable files
  //   const fs = await fsPromise;
  //   const files = await Promise.all(
  //     Object.values(filesFromInbox).map(f => fs.saveFile(f, f.name).then(() => fs.readonlyFile(f.name),
  //     )),
  //   );
  //   // echo it all back, adding replyTo reference
  //   await sendMessageInChat({ chatId, text: body, files, relatedMessage: { replyTo: { chatMessageId } } });
  // };
}

function displayUpdateEvent(ev: UpdateEvent): void {
  const { updatedEntityType, event } = ev;
  delete (ev as any).updatedEntityType;
  delete (ev as any).event;
  addMsgToPage(`🖥️ ${updatedEntityType} ${event} ${Object.values(ev).map(v => JSON.stringify(v, null, 2)).join(', ')}`);
}
