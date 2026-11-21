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
import { ref } from 'vue';
import { defineStore } from 'pinia';
import { inboxSrv } from '@common/services/services-provider';
import type { OutgoingMessageView } from '@common/types';
import type { InboxUpdateEvent } from '@deno/types/inbox-srv.types';

export const useSendingStore = defineStore('sending', () => {
  const listOfSendingMessage = ref<Record<string, web3n.asmail.DeliveryProgress>>({});

  function applySendingEvent(event: Extract<InboxUpdateEvent, { entity: 'sending' }>) {
    if (event.event === 'progress') {
      listOfSendingMessage.value[event.id] = event.progress;
      return;
    }
    delete listOfSendingMessage.value[event.id];
  }

  async function sendMessage(msgData: OutgoingMessageView) {
    await inboxSrv.sendMessage(msgData);
  }

  async function cancelSendMessage(msgId: string): Promise<void> {
    await inboxSrv.cancelSendMessage(msgId);
  }

  return {
    listOfSendingMessage,
    applySendingEvent,
    sendMessage,
    cancelSendMessage,
  };
});
